'use client'

// The contract board's operations map: the War Table's relief with the board's own
// contracts pinned to their sites. Hovering or focusing a contract glides the table to
// its site; picking a site on the table filters the list to it. Statuses come from the
// same presenters as the War Room (readiness), and the pins from the board itself.

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type BoardEntry, type WorldView } from '@/lib/api'
import { buildTable } from '@/lib/world/table'
import { describeFaction, READINESS_LABEL } from '@/lib/presenter/economy'
import { inboundFor } from '@/components/world/Readiness'
import { useSettings } from '@/lib/settings'
import type { FacilityStatus, Tone } from './WarTable'

const WarTable3D = dynamic(() => import('./WarTable3D'), { ssr: false, loading: () => <div className="aspect-[4/3] w-full bg-ink-2 sm:aspect-[16/10]" aria-hidden /> })
const READY_TONE = { operational: 'ok', under_pressure: 'warn', supply_critical: 'critical', rebuilding: 'info' } as const

export function BoardTable({ world, board, focusSite, picked, onPick }: {
  world: WorldView | undefined; board: BoardEntry[]
  /** The site the player is looking at in the list (hover or keyboard focus). */
  focusSite: string | null
  /** The site the list is filtered to, if any. */
  picked: string | null
  onPick: (siteId: string | null) => void
}) {
  const settings = useSettings()
  const war = useQuery({ queryKey: ['warroom', 1], queryFn: () => api.warRoom(1), refetchInterval: 15_000 })
  const market = useQuery({ queryKey: ['market'], queryFn: api.market, refetchInterval: 15_000 })
  const model = useMemo(() => (war.data ? buildTable({ sites: world?.sites ?? [], war: war.data.world, merchants: market.data?.merchants }) : null), [war.data, world?.sites, market.data?.merchants])
  const status = useMemo(() => {
    const out: Record<string, FacilityStatus> = {}
    if (!model || !war.data) return out
    for (const f of model.facilities) {
      if (f.kind !== 'site') continue
      const a = war.data.world.actors.find((x) => x.id === f.owner)
      const site = world?.sites?.find((s) => s.id === f.siteId)
      const p = a ? describeFaction(a, inboundFor(a.id, market.data?.orders, war.data.world.convoys)) : null
      out[f.id] = {
        label: p ? READINESS_LABEL[p.readiness] : '', tone: (p ? READY_TONE[p.readiness] : 'info') as Tone,
        linesDown: site?.lines.filter((l) => l.down_until != null).length ?? 0,
        openContracts: board.filter((b) => b.site?.id === f.id).length,
        activeOperations: 0,
      }
    }
    return out
  }, [model, war.data, world?.sites, market.data?.orders, board])
  if (!model) return <div className="aspect-[4/3] w-full bg-ink-2 sm:aspect-[16/10]" aria-hidden />
  // On the board the table is about sites: merchants stay on it as landmarks, but only sites can be picked.
  const pick = (id: string) => { const f = model.facilities.find((x) => x.id === id); if (f?.kind === 'site') onPick(picked === id ? null : id) }
  return (
    <WarTable3D model={model} status={status} selectedId={picked ?? focusSite} focusId={focusSite ?? picked} onSelect={pick}
      tick={war.data?.world.tick ?? 0} supply={undefined} reduce={settings.access.reduceMotion} />
  )
}
