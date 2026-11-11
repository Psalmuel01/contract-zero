// A supply order played out on the War Table: who asked, which merchants really answered,
// who won, whether anything was delivered. Built only from the order's own records
// (the same ones describeProcurement tells as seven stages), so the table can only show
// what happened: an arc for each merchant that made an offer (a lone offer is shown as
// one arc and never called a contest), a solid arc for each that filled, a crate on the
// road only when something was delivered, and the settlement as the records state it.

import type { ProcurementChain } from '@/lib/api'
import { describeProcurement, type StageKey, type TimelineStage } from './procurement'

export interface SceneBeat {
  key: StageKey
  title: string
  summary: string
  state: TimelineStage['state']
}

export interface ProcurementScene {
  order: number
  requester: string
  requesterName: string
  resource: ProcurementChain['resource']
  /** 'buy': goods flow from the merchant to the faction; 'sell': the other way. */
  side: ProcurementChain['side']
  /** Merchants that made an offer, in the order they answered. */
  offered: string[]
  /** Merchants that answered and declined. */
  declined: string[]
  /** Merchants whose offer filled the order. */
  winners: string[]
  /** Units delivered (0: nothing travelled). */
  delivered: number
  /** True only when there were two or more offers. */
  contested: boolean
  /** The beats worth playing: stages that happened or are under way, in order. */
  beats: SceneBeat[]
  /** One line for the settlement, exactly as recorded. */
  settlement: 'confirmed' | 'in flight' | 'failed' | 'no on-chain record'
}

export function procurementScene(c: ProcurementChain): ProcurementScene {
  const t = describeProcurement(c)
  const firstAnswer = new Map<string, number>()
  for (const a of c.answers) if (!firstAnswer.has(a.merchant)) firstAnswer.set(a.merchant, a.tick)
  const offered = [...new Set(c.answers.filter((a) => a.proposed).map((a) => a.merchant))].sort((a, b) => (firstAnswer.get(a) ?? 0) - (firstAnswer.get(b) ?? 0))
  const declined = [...new Set(c.answers.filter((a) => !a.proposed).map((a) => a.merchant))].filter((m) => !offered.includes(m))
  const winners = [...new Set(c.fills.map((f) => f.merchant))]
  const st = t.stages.find((s) => s.key === 'settlement')!.state
  return {
    order: c.order,
    requester: c.requester,
    requesterName: c.requester_name,
    resource: c.resource,
    side: c.side,
    offered, declined, winners,
    delivered: c.delivered,
    contested: offered.length >= 2,
    beats: t.stages.filter((s) => s.state === 'done' || s.state === 'pending' || s.state === 'failed').map((s) => ({ key: s.key, title: s.title, summary: s.summary, state: s.state })),
    settlement: st === 'done' ? 'confirmed' : st === 'pending' ? 'in flight' : st === 'failed' ? 'failed' : 'no on-chain record',
  }
}

/** Which elements are on the table by the time beat `i` plays. */
export function sceneAt(s: ProcurementScene, i: number): { flare: boolean; order: boolean; arcs: string[]; won: string[]; crate: boolean } {
  const upTo = new Set(s.beats.slice(0, i + 1).map((b) => b.key))
  return {
    flare: upTo.has('shortage'),
    order: upTo.has('order'),
    arcs: upTo.has('bids') ? s.offered : [],
    won: upTo.has('winner') ? s.winners : [],
    crate: upTo.has('arrival') && s.delivered > 0,
  }
}
