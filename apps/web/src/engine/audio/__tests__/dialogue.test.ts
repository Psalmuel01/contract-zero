import { describe, expect, it, vi } from 'vitest'
import { Dialogue, type DialogueOutcome } from '../dialogue'
import { FakeAudioContext, FakeNode } from './fakeAudioContext'

// Every way a character's line can go: voiced from a pre-generated file, voiced by the
// server (mission lines, AI-rewritten or not; the strategic radio), from cache, or, when
// no voice can be had in time, the speaker's brief tone and the subtitle. Never speech
// that isn't real: no path may build an oscillator or a distortion stage.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ok = (bytes = 8) => Promise.resolve(new Response(new ArrayBuffer(bytes), { status: 200 }))

function rig(opts: { fetch?: (src: string, init?: RequestInit) => Promise<Response>; decode?: (b: ArrayBuffer) => Promise<unknown>; deadlineMs?: number; turnMs?: number; noCtx?: boolean } = {}) {
  const ctx = new FakeAudioContext()
  ;(ctx as unknown as { decodeAudioData: (b: ArrayBuffer) => Promise<unknown> }).decodeAudioData = opts.decode ?? (() => Promise.resolve({ duration: 2 }))
  const out = new FakeNode('voiceBus', ctx)
  const tones: string[] = [], ducks: number[] = [], log: DialogueOutcome[] = []
  const fetchFn = vi.fn(opts.fetch ?? (() => ok()))
  let clock = 1_000
  const d = new Dialogue(
    { ctx: () => (opts.noCtx ? null : (ctx as unknown as BaseAudioContext)), output: () => (opts.noCtx ? null : (out as unknown as AudioNode)), tone: (s) => tones.push(s), duck: (s) => ducks.push(s) },
    { fetch: fetchFn as unknown as typeof fetch, deadlineMs: opts.deadlineMs ?? 200, turnMs: opts.turnMs ?? 4000, now: () => clock, log: (o) => log.push(o) },
  )
  const started = () => ctx.starts.filter((s) => s.kind === 'source').length
  return { d, ctx, fetchFn, tones, ducks, log, started, advance: (ms: number) => { clock += ms } }
}

describe('a line is spoken in a real voice when it has one', () => {
  it('an authored line plays its pre-generated file', async () => {
    const r = rig()
    const o = await r.d.say('handler-first-contact', 'handler')
    expect(o).toMatchObject({ source: 'pregenerated' })
    expect(r.fetchFn).toHaveBeenCalledWith('/vo/handler-first-contact.mp3', expect.objectContaining({ credentials: 'same-origin' }))
    expect(r.started()).toBe(1)
    expect(r.tones).toEqual(['handler'])
    expect(r.ducks[0]).toBeCloseTo(2.3)   // the voice's own length, plus a breath
  })

  it("a mission's own line (written or AI-rewritten by the server) plays the server's voice for it", async () => {
    const r = rig()
    const url = 'https://api.example/missions/s1/vo/dyn-start'
    const o = await r.d.say('dyn-start', 'vanguard', url)
    expect(o).toMatchObject({ source: 'dynamic' })
    expect(r.fetchFn).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: 'include' }))
    expect(r.started()).toBe(1)
  })

  it('a strategic radio line plays the voice the server made for its own text', async () => {
    const r = rig()
    const o = await r.d.say('radio-decision-14433', 'vanguard', 'https://api.example/radio/decision-14433/vo')
    expect(o).toMatchObject({ source: 'dynamic' })
    expect(r.started()).toBe(1)
  })

  it('a line heard before comes from cache: fetched and decoded once', async () => {
    const r = rig()
    await r.d.say('handler-low-ammo', 'handler')
    r.advance(10_000)
    const o = await r.d.say('handler-low-ammo', 'handler')
    expect(o.source).toBe('cache')
    expect(r.fetchFn).toHaveBeenCalledTimes(1)
  })

  it('a prefetched line, and two asks at once, share one fetch', async () => {
    const r = rig()
    const url = 'https://api.example/missions/s1/vo/dyn-push'
    r.d.prefetch(url)
    const [a] = await Promise.all([r.d.say('dyn-push', 'handler', url), r.d.say('dyn-push', 'handler', url)])
    expect(a.source).toBe('dynamic')
    expect(r.fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('when no voice can be had in time: the tone and the subtitle, never fake speech', () => {
  it('a line with no voice source', async () => {
    const r = rig()
    const o = await r.d.say('dyn-reinforce', 'handler')
    expect(o).toMatchObject({ source: 'subtitle-only', reason: 'no voice for this line' })
    expect(r.fetchFn).not.toHaveBeenCalled()
    expect(r.tones).toEqual(['handler'])
    expect(r.ducks).toEqual([])
  })

  it('a missing file (404)', async () => {
    const r = rig({ fetch: () => Promise.resolve(new Response('', { status: 404 })) })
    expect(await r.d.say('handler-op-start', 'handler')).toMatchObject({ source: 'subtitle-only', reason: 'http 404' })
    expect(r.started()).toBe(0)
  })

  it('a network error, or the voice service failing (5xx)', async () => {
    expect(await rig({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) }).d.say('handler-op-start', 'handler')).toMatchObject({ source: 'subtitle-only', reason: 'network error' })
    expect(await rig({ fetch: () => Promise.resolve(new Response('', { status: 503 })) }).d.say('x', 'vex', 'https://api.example/radio/order-9/vo')).toMatchObject({ source: 'subtitle-only', reason: 'http 503' })
  })

  it('malformed audio that will not decode', async () => {
    const r = rig({ decode: () => Promise.reject(new Error('EncodingError')) })
    expect(await r.d.say('handler-op-start', 'handler')).toMatchObject({ source: 'subtitle-only', reason: 'could not decode' })
    expect(r.started()).toBe(0)
  })

  it('a slow synthesis or download: past the deadline it is subtitle-only, and the late voice never plays', async () => {
    const r = rig({ deadlineMs: 50, fetch: () => sleep(150).then(() => ok()) })
    expect(await r.d.say('dyn-slow', 'ashen', 'https://api.example/missions/s/vo/dyn-slow')).toMatchObject({ source: 'subtitle-only', reason: 'not ready in time' })
    await sleep(200)
    expect(r.started()).toBe(0)   // arriving late, it is cached for next time but not played now
  })

  it('a slow decode past the deadline, likewise', async () => {
    const r = rig({ deadlineMs: 50, decode: () => sleep(150).then(() => ({ duration: 1 })) })
    expect(await r.d.say('handler-op-start', 'handler')).toMatchObject({ source: 'subtitle-only', reason: 'not ready in time' })
    await sleep(200)
    expect(r.started()).toBe(0)
  })

  it('before audio has started, a line is its subtitle (and no tone is attempted)', async () => {
    const r = rig({ noCtx: true })
    expect(await r.d.say('handler-op-start', 'handler')).toMatchObject({ source: 'subtitle-only', reason: 'audio not started' })
    expect(r.tones).toEqual([])
  })

  it('a failure is not remembered: the next ask tries again', async () => {
    let fail = true
    const r = rig({ fetch: () => (fail ? Promise.resolve(new Response('', { status: 404 })) : ok()) })
    expect((await r.d.say('handler-op-start', 'handler')).source).toBe('subtitle-only')
    fail = false
    expect((await r.d.say('handler-op-start', 'handler')).source).toBe('pregenerated')
  })

  it('no path ever builds speech of its own: no oscillator, no distortion', async () => {
    const r = rig({ fetch: () => Promise.resolve(new Response('', { status: 404 })) })
    for (const who of ['handler', 'vanguard', 'ashen', 'vex', 'halcyon'] as const) {
      await r.d.say(`dyn-${who}`, who)
      await r.d.say('handler-op-start', who)
    }
    const ok2 = rig()
    for (const who of ['handler', 'vanguard', 'ashen', 'vex', 'halcyon'] as const) await ok2.d.say(`l-${who}`, who, `https://api.example/vo/${who}`)
    for (const c of [r.ctx, ok2.ctx]) { expect(c.nodesByKind.osc ?? 0).toBe(0); expect(c.nodesByKind.shaper ?? 0).toBe(0) }
  })
})

describe('one transmission at a time', () => {
  it('a line that arrives while another speaks waits for the channel, then plays', async () => {
    const r = rig()
    await r.d.say('handler-op-start', 'handler')          // 2 s of voice
    r.advance(500)
    const o = await r.d.say('vanguard-first-word', 'vanguard')
    expect(o.source).toBe('pregenerated')
    expect(o.waitedMs).toBeGreaterThan(1500)                // queued behind the first
    const second = r.ctx.starts.filter((s) => s.kind === 'source')[1]
    expect(second.t).toBeGreaterThan(1.5)                    // scheduled after it, not over it
  })

  it('if the channel stays busy too long, the waiting line is its subtitle rather than late speech', async () => {
    const r = rig({ turnMs: 1000 })
    await r.d.say('handler-op-start', 'handler')
    r.advance(100)
    expect(await r.d.say('vanguard-first-word', 'vanguard')).toMatchObject({ source: 'subtitle-only', reason: 'channel busy' })
  })
})
