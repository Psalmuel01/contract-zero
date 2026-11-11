'use client'

// The Hub's one operational update: what changed since the player last looked, from the
// server's own records (lib/world/sinceVisit), and where each faction stands now. It
// replaces the old strip of status, alert and activity panels; the War Table has the rest.
// The last look is remembered on this device when the player leaves the Hub.

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { describeFaction, READINESS_LABEL } from '@/lib/presenter/economy'
import { useReadinessData } from '@/components/world/Readiness'
import { FactionInsignia } from '@/components/ui/FactionInsignia'
import { sinceVisit, type LastVisit } from '@/lib/world/sinceVisit'
import { worldClock } from '@/lib/presenter/consequence'

const KEY = 'cz_hub_last'
const TONE: Record<string, string> = { Operational: 'text-friendly', 'Under Pressure': 'text-amber-hi', 'Supply Critical': 'text-hostile', Rebuilding: 'text-steel' }

function readLast(): LastVisit | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return v && typeof v.tick === 'number' ? v : null } catch { return null }
}

export function SinceVisit({ tick, factions }: { tick: number | undefined; factions: { id: string; name: string }[] }) {
  const readiness = useReadinessData()
  const decisions = useQuery({ queryKey: ['decisions', 40], queryFn: () => api.decisions(40), refetchInterval: 15_000 })
  const procurement = useQuery({ queryKey: ['procurement'], queryFn: () => api.procurement(10), refetchInterval: 10_000 })
  const ops = useQuery({ queryKey: ['war-operations'], queryFn: () => api.warOperations(10), refetchInterval: 15_000 })
  const [last, setLast] = useState<LastVisit | null | undefined>(undefined)
  useEffect(() => { setLast(readLast()) }, [])

  const labels = useMemo(() => {
    const out: Record<string, { name: string; label: string }> = {}
    for (const f of factions) {
      const a = readiness.actor(f.id)
      if (a) out[f.id] = { name: f.name, label: READINESS_LABEL[describeFaction(a, readiness.inbound(f.id)).readiness] }
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factions, readiness.ready, readiness.actor])

  const lines = useMemo(() => sinceVisit({ last: last ?? null, readiness: labels, decisions: decisions.data ?? [], chains: procurement.data ?? [], operations: ops.data ?? [] }),
    [last, labels, decisions.data, procurement.data, ops.data])

  // Remember this look when the player leaves the Hub (not on load: a refresh must not wipe the news).
  const snap = useRef<LastVisit | null>(null)
  snap.current = tick != null && Object.keys(labels).length ? { tick, at: Date.now(), readiness: Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.label])) } : snap.current
  useEffect(() => {
    const save = () => { if (snap.current) try { localStorage.setItem(KEY, JSON.stringify(snap.current)) } catch { /* private mode */ } }
    window.addEventListener('pagehide', save)
    return () => { window.removeEventListener('pagehide', save); save() }
  }, [])

  return (
    <section className="cz-panel p-4" data-testid="since-visit" aria-labelledby="since-visit-h">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="since-visit-h" className="cz-label">Since you were last here</h2>
        {last && tick != null && <span className="text-[11px] text-dim">{worldClock(last.tick)} → {worldClock(tick)}</span>}
        <Link href="/war-room" className="ml-auto inline-flex min-h-6 items-center text-xs text-steel hover:text-fog">Open the War Table →</Link>
      </div>
      {last === undefined ? null : !last ? (
        <p className="mt-2 text-sm text-muted">First look at the front. Come back after a contract and what changed will be here.</p>
      ) : lines.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Quiet. Nothing on record has changed since your last look.</p>
      ) : (
        <ul className="mt-2 grid gap-1.5 text-sm">
          {lines.map((l, i) => (
            <li key={i} className="flex items-start gap-2">
              <FactionInsignia id={l.who} className="mt-0.5 h-4 w-4 shrink-0" />
              <span className={l.kind === 'readiness' ? 'text-fog' : 'text-muted'}>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-2.5">
        {factions.map((f) => (
          <span key={f.id} className="flex items-center gap-1.5 text-xs" data-testid={`hub-readiness-${f.id}`}>
            <FactionInsignia id={f.id} className="h-4 w-4" />
            <span className="font-display font-bold uppercase tracking-wider text-fog">{f.name}</span>
            <span className={`font-display font-semibold uppercase tracking-widest ${TONE[labels[f.id]?.label ?? ''] ?? 'text-dim'}`}>{labels[f.id]?.label ?? '…'}</span>
          </span>
        ))}
      </div>
    </section>
  )
}
