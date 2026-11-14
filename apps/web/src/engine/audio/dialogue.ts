// Character dialogue on the radio: real voices only.
//
// A line is spoken from one of two sources, or not spoken at all:
//  - PREGENERATED: an authored line voiced in advance (public/vo, apps/tts/pregen.py);
//  - DYNAMIC: a line the server wrote and voiced (a mission's story, AI-rewritten or not;
//    the strategic radio), fetched from the API by the line's own address.
// If neither exists, or the voice can't be fetched and decoded within DEADLINE_MS (a
// later voice would trail its caption), the line is its subtitle plus the speaker's brief
// radio tone. There is no synthetic speech of any kind: no murmur, no babble.
//
// Fetches are shared (a line asked for twice is fetched once), can start early
// (prefetch: the deploy screen and the strategic radio do), and two transmissions never
// overlap: a line waits a moment for the channel, or falls back to its subtitle.

import type { Speaker } from '../story/presence'
import voManifest from '../../../public/vo/manifest.json'

/** Authored lines voiced in advance, by id. */
export const PREVOICED = new Set(Object.keys(voManifest))

export type DialogueSource = 'pregenerated' | 'dynamic' | 'cache' | 'subtitle-only'
export interface DialogueOutcome {
  id: string
  source: DialogueSource
  /** Why it fell back to its subtitle, when it did. */
  reason?: string
  /** How long the channel made it wait, when another transmission was on. */
  waitedMs?: number
}

export interface DialogueHost {
  ctx(): BaseAudioContext | null
  /** Where voices go (the voice bus). */
  output(): AudioNode | null
  /** The speaker's brief radio tone: every transmission starts with it. */
  tone(speaker: Speaker): void
  /** Dip the rest of the mix while a voice speaks. */
  duck(seconds: number): void
}

export interface DialogueOptions {
  fetch?: typeof fetch
  deadlineMs?: number
  /** How long a line may wait for the channel before it falls back to its subtitle. */
  turnMs?: number
  now?: () => number
  log?: (o: DialogueOutcome) => void
}

/** A voice later than this would land well after its caption. */
export const DEADLINE_MS = 1500
const TURN_MS = 4000
const MAX_CACHED = 64

/** Per-speaker level after the chain's compressor (the voice bus slider applies after). */
const LEVEL: Record<Speaker, number> = { handler: 1.2, halcyon: 1.15, vanguard: 1.2, vex: 1.15, ashen: 1.15 }

/**
 * The radio's colour, kept light: a wide band (160 Hz to 6.5 kHz; Halcyon's desk headset
 * a little wider, Ashen's set a little narrower), 2 dB of presence at 3 kHz, and a gentle
 * compressor so a line holds its level over a fight. No waveshaper: the old chain drove
 * Ashen through distortion and boosted 2.4 kHz by 4 dB into a 3.6 kHz ceiling, which is
 * where "harsh" and "muffled" both came from.
 */
export function buildVoiceChain(ctx: BaseAudioContext, speaker: Speaker, input: AudioNode, output: AudioNode): AudioNode[] {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160; hp.Q.value = 0.7
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7
  lp.frequency.value = speaker === 'halcyon' ? 7500 : speaker === 'ashen' ? 5000 : 6500
  const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3000; pres.Q.value = 1; pres.gain.value = 2
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.15
  const g = ctx.createGain(); g.gain.value = LEVEL[speaker]
  input.connect(hp).connect(pres).connect(lp).connect(comp).connect(g).connect(output)
  return [hp, pres, lp, comp, g]
}

const devLog = (o: DialogueOutcome) => {
  // Development only. Ids and outcomes, never URLs (a mission line's URL carries its session).
  if (process.env.NODE_ENV === 'development') console.debug(`[radio] ${o.id}: ${o.source}${o.reason ? ` (${o.reason})` : ''}${o.waitedMs ? ` after waiting ${o.waitedMs} ms` : ''}`)
}

export class Dialogue {
  private bytes = new Map<string, Promise<ArrayBuffer>>()
  private buffers = new Map<string, AudioBuffer>()
  private durations = new Map<string, number>()
  private busyUntil = 0
  private fetchFn: typeof fetch
  private deadlineMs: number
  private turnMs: number
  private now: () => number
  private log: (o: DialogueOutcome) => void

  constructor(private host: DialogueHost, opts: DialogueOptions = {}) {
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init))
    this.deadlineMs = opts.deadlineMs ?? DEADLINE_MS
    this.turnMs = opts.turnMs ?? TURN_MS
    this.now = opts.now ?? (() => Date.now())
    this.log = opts.log ?? devLog
  }

  /** Where a line's voice comes from, if anywhere. */
  sourceOf(id: string, url?: string): { src: string; kind: 'pregenerated' | 'dynamic' } | null {
    if (url) return { src: url, kind: 'dynamic' }
    if (PREVOICED.has(id)) return { src: `/vo/${id}.mp3`, kind: 'pregenerated' }
    return null
  }

  /** Start fetching a line's voice now (no audio context needed: decoding waits for play). */
  prefetch(src: string): void {
    void this.load(src).catch(() => {})
  }

  /** Real length of a voice that played, so the caption can be held for all of it. */
  duration(id: string): number | undefined {
    return this.durations.get(id)
  }

  private load(src: string): Promise<ArrayBuffer> {
    let p = this.bytes.get(src)
    if (!p) {
      p = this.fetchFn(src, { credentials: src.startsWith('/') ? 'same-origin' : 'include' })
        .catch(() => Promise.reject(new Error('network error')))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`http ${r.status}`))))
      // A failure is not remembered: the next ask (or a later prefetch) tries again.
      p.catch(() => { if (this.bytes.get(src) === p) this.bytes.delete(src) })
      this.bytes.set(src, p)
      while (this.bytes.size > MAX_CACHED) this.bytes.delete(this.bytes.keys().next().value!)
    }
    return p
  }

  private async decode(src: string, ctx: BaseAudioContext): Promise<AudioBuffer> {
    const hit = this.buffers.get(src)
    if (hit) return hit
    const bytes = await this.load(src)
    // decodeAudioData detaches its input; keep the cached bytes intact.
    const buf = await ctx.decodeAudioData(bytes.slice(0)).catch(() => Promise.reject(new Error('could not decode')))
    this.buffers.set(src, buf)
    while (this.buffers.size > MAX_CACHED) this.buffers.delete(this.buffers.keys().next().value!)
    return buf
  }

  /** Say a line: its voice if it can be had in time, else its tone and subtitle only. */
  async say(id: string, speaker: Speaker, url?: string): Promise<DialogueOutcome> {
    const done = (o: DialogueOutcome) => { this.log(o); return o }
    const ctx = this.host.ctx(), out = this.host.output()
    if (ctx && out) this.host.tone(speaker)
    const s = this.sourceOf(id, url)
    if (!s) return done({ id, source: 'subtitle-only', reason: 'no voice for this line' })
    if (!ctx || !out) return done({ id, source: 'subtitle-only', reason: 'audio not started' })
    const cached = this.buffers.has(s.src)
    let buf: AudioBuffer
    try {
      buf = await Promise.race([
        this.decode(s.src, ctx),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('not ready in time')), this.deadlineMs)),
      ])
    } catch (e) {
      return done({ id, source: 'subtitle-only', reason: (e as Error).message })
    }
    // One transmission at a time.
    const now = this.now()
    const wait = Math.max(0, this.busyUntil - now)
    if (wait > this.turnMs) return done({ id, source: 'subtitle-only', reason: 'channel busy' })
    this.durations.set(id, buf.duration + wait / 1000)
    const node = (ctx as AudioContext).createBufferSource()
    node.buffer = buf
    buildVoiceChain(ctx, speaker, node, out)
    this.host.duck(buf.duration + wait / 1000 + 0.3)
    node.start(ctx.currentTime + wait / 1000)
    this.busyUntil = now + wait + buf.duration * 1000 + 250
    return done({ id, source: cached ? 'cache' : s.kind, ...(wait ? { waitedMs: Math.round(wait) } : {}) })
  }

  /**
   * For comparison and recordings: a voice rendered offline either clean (as synthesized)
   * or through the radio chain the game uses. Returns mono samples at the file's rate.
   */
  async render(src: string, speaker: Speaker, processed: boolean): Promise<{ rate: number; samples: Float32Array }> {
    const bytes = await this.load(src)
    const probe = new OfflineAudioContext(1, 1, 48000)
    const buf = await probe.decodeAudioData(bytes.slice(0))
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * buf.sampleRate) + buf.sampleRate / 4, buf.sampleRate)
    const node = off.createBufferSource()
    node.buffer = buf
    if (processed) buildVoiceChain(off, speaker, node, off.destination)
    else node.connect(off.destination)
    node.start()
    const out = await off.startRendering()
    return { rate: out.sampleRate, samples: out.getChannelData(0) }
  }
}
