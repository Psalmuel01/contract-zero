'use client'

// Supply orders played on the War Table. A new order that arrives while you watch plays
// by itself, once; any recent order can be played on demand. Each beat is a stage the
// server recorded (describeProcurement), shown on the relief (sceneAt) and on a card with
// the speaker's portrait. Nothing is played that did not happen, a lone offer is never a
// contest, and the settlement chip says exactly what the records say.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProcurementChain } from '@/lib/api'
import { procurementScene, type ProcurementScene } from '@/lib/presenter/procurementScene'
import { Portrait } from '@/components/ui/Portrait'
import { personaFor, attribution } from '@/lib/personas'

const BEAT_MS = 3400
/** Orders already on the server when the page first looked: history, never auto-played. */
const seen = new Set<number>()
let primed = false

export interface Story { scene: ProcurementScene; beat: number }

const SETTLE_TONE: Record<ProcurementScene['settlement'], string> = {
  confirmed: 'border-friendly text-friendly', 'in flight': 'border-amber text-amber-hi', failed: 'border-hostile text-hostile', 'no on-chain record': 'border-line text-muted',
}
const SETTLE_TEXT: Record<ProcurementScene['settlement'], string> = {
  confirmed: 'Settled on NEAR', 'in flight': 'Settlement in flight', failed: 'Settlement failed', 'no on-chain record': 'No on-chain record',
}

/** Who speaks for a beat: the faction for its own needs, the merchant for its offer and its win. */
function speaker(s: ProcurementScene, key: string): string {
  if (key === 'bids') return s.offered[0] ?? s.requester
  if (key === 'winner') return s.winners[0] ?? s.requester
  return s.requester
}

export function useOrderPlayer(chains: ProcurementChain[] | undefined, reduce: boolean) {
  const [playing, setPlaying] = useState<{ order: number; beat: number; manual: boolean } | null>(null)
  const scenes = useMemo(() => (chains ?? []).map(procurementScene).filter((s) => s.beats.length > 0), [chains])
  // a new order, arriving while the page is open, plays by itself
  useEffect(() => {
    if (!chains) return
    if (!primed) { primed = true; chains.forEach((c) => seen.add(c.order)); return }
    const fresh = chains.filter((c) => !seen.has(c.order))
    fresh.forEach((c) => seen.add(c.order))
    if (fresh.length && !playing) setPlaying({ order: fresh[0].order, beat: reduce ? 99 : 0, manual: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chains])
  const scene = scenes.find((s) => s.order === playing?.order) ?? null
  const beat = scene && playing ? Math.min(playing.beat, scene.beats.length - 1) : 0
  // advance on its own unless the player has taken the controls (or motion is reduced)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!scene || !playing || playing.manual || reduce) return
    const last = beat >= scene.beats.length - 1
    timer.current = setTimeout(() => setPlaying((p) => (p ? (last ? null : { ...p, beat: p.beat + 1 }) : p)), last ? BEAT_MS * 2.5 : BEAT_MS)
    return () => clearTimeout(timer.current)
  }, [scene, playing, beat, reduce])
  return {
    scenes,
    story: scene ? ({ scene, beat } satisfies Story) : null,
    play: (order: number) => setPlaying({ order, beat: reduce ? 99 : 0, manual: false }),
    step: (d: number) => setPlaying((p) => (p && scene ? { ...p, beat: Math.max(0, Math.min(scene.beats.length - 1, beat + d)), manual: true } : p)),
    stop: () => setPlaying(null),
  }
}

/** The card laid over the relief while an order plays. */
export function OrderCard({ story, onStep, onStop }: { story: Story; onStep: (d: number) => void; onStop: () => void }) {
  const s = story.scene
  const b = s.beats[story.beat]
  const who = speaker(s, b.key)
  const p = personaFor(who)
  return (
    <div className="absolute inset-x-2 bottom-2 z-30 sm:right-auto sm:max-w-md" data-testid="order-card" role="region" aria-label={`Supply order ${s.order}, ${b.title}`} aria-live="polite">
      <div className="cz-panel flex gap-3 bg-panel/95 p-3 text-sm">
        <div className="hidden shrink-0 sm:block"><Portrait id={who} size={56} title={p ? attribution(p) : who} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="cz-label">Supply order #{s.order}</span>
            <span className={`border px-1.5 text-[10px] uppercase tracking-widest ${s.contested ? 'border-amber text-amber-hi' : 'border-line text-muted'}`}>{s.offered.length === 0 ? 'no offers' : s.contested ? `${s.offered.length} competing offers` : 'single offer'}</span>
            <span className={`border px-1.5 text-[10px] uppercase tracking-widest ${SETTLE_TONE[s.settlement]}`}>{SETTLE_TEXT[s.settlement]}</span>
          </div>
          <div className="mt-1 font-display text-[13px] font-bold uppercase tracking-wider text-fog">{b.title}{b.state === 'pending' ? ' · under way' : b.state === 'failed' ? ' · failed' : ''}</div>
          <p className="mt-0.5 text-muted">{b.summary}</p>
          {p && <p className="mt-1 text-[11px] text-dim">{attribution(p)}</p>}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex gap-1" aria-hidden>{s.beats.map((x, i) => <span key={x.key} className={`h-1.5 w-4 ${i <= story.beat ? 'bg-amber' : 'bg-line'}`} />)}</div>
            <div className="ml-auto flex gap-1">
              <button type="button" className="border border-line px-2 py-0.5 text-xs text-muted hover:text-fog disabled:opacity-40" onClick={() => onStep(-1)} disabled={story.beat === 0} aria-label="Previous stage">‹</button>
              <button type="button" className="border border-line px-2 py-0.5 text-xs text-muted hover:text-fog disabled:opacity-40" onClick={() => onStep(1)} disabled={story.beat >= s.beats.length - 1} aria-label="Next stage">›</button>
              <button type="button" className="border border-line px-2 py-0.5 text-xs text-muted hover:text-fog" onClick={onStop} data-testid="order-card-close">Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Recent supply orders, each one playable on the table. */
export function OrderStrip({ scenes, playing, onPlay }: { scenes: ProcurementScene[]; playing: number | null; onPlay: (order: number) => void }) {
  if (!scenes.length) return null
  return (
    <div className="mt-3" data-testid="order-strip">
      <h3 className="cz-label mb-1.5">Supply orders on the table</h3>
      <ul className="grid gap-1">
        {scenes.slice(0, 4).map((s) => {
          const last = s.beats[s.beats.length - 1]
          return (
            <li key={s.order} className="flex items-center gap-2 border-b border-line/60 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate"><span className="text-fog">{s.requesterName}</span> <span className="text-muted">· {s.resource} · {s.contested ? `${s.offered.length} offers` : s.offered.length === 1 ? 'one offer' : 'no offers'} · {last.title.toLowerCase()}</span></span>
              <button type="button" onClick={() => onPlay(s.order)} aria-pressed={playing === s.order} data-testid={`play-order-${s.order}`}
                className={`shrink-0 border px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-widest ${playing === s.order ? 'border-amber text-amber-hi' : 'border-line text-muted hover:text-fog'}`}>{playing === s.order ? 'Playing' : 'Play'}</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
