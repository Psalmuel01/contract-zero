// "Since you were last here": the Hub's one operational update. Everything in it is a
// record the server holds that is newer than the player's last look (by world tick for
// the economy, by wall clock for operations), plus readiness changes measured against
// what the Hub showed them last time. Nothing is inferred: no record, no line.

import type { AgentEvent, OperationRecord, ProcurementChain } from '@/lib/api'
import { radioFromDecisions } from '@/engine/story/strategicRadio'

export interface LastVisit {
  /** World tick at the last look. */
  tick: number
  /** Wall clock (ms) at the last look. */
  at: number
  /** Readiness label per faction, as shown then. */
  readiness: Record<string, string>
}

export interface Dispatch {
  kind: 'readiness' | 'supply' | 'decision' | 'operation'
  /** Whose news it is (a faction or merchant id), for the insignia. */
  who: string
  text: string
  tick: number | null
}

const NAME: Record<string, string> = { ammo: 'ammunition', med: 'medicine', fuel: 'fuel' }

export function sinceVisit(o: {
  last: LastVisit | null
  readiness: Record<string, { name: string; label: string }>
  decisions: readonly AgentEvent[]
  chains: readonly ProcurementChain[]
  operations: readonly OperationRecord[]
  max?: number
}): Dispatch[] {
  if (!o.last) return []
  const last = o.last
  const out: Dispatch[] = []
  for (const [id, now] of Object.entries(o.readiness)) {
    const was = last.readiness[id]
    if (was && was !== now.label) out.push({ kind: 'readiness', who: id, text: `${now.name}: ${was} → ${now.label}.`, tick: null })
  }
  for (const op of o.operations) {
    if (Date.parse(op.completed_at) <= last.at) continue
    const whose = `${o.readiness[op.target]?.name ?? op.target.charAt(0).toUpperCase() + op.target.slice(1)}'s`
    const what = op.kind === 'sabotage' ? `sabotaged ${whose} ${NAME[op.resource]} line` : op.kind === 'recovery' ? `recovered ${NAME[op.resource]} seized by ${whose.slice(0, -2)}` : `raided ${whose} ${NAME[op.resource]}`
    const how = op.outcome === 'extracted' ? (op.extracted_units > 0 ? `, ${op.extracted_units} units carried out` : '') : op.outcome === 'killed' ? ' and did not come back' : ` (${op.outcome})`
    out.push({ kind: 'operation', who: op.target, text: `An operator ${what}${how}.`, tick: null })
  }
  for (const c of o.chains) {
    if (!c.fills.length) continue
    const tick = Math.max(...c.fills.map((f) => f.tick))
    if (tick <= last.tick) continue
    const qty = c.fills.reduce((s, f) => s + f.qty, 0)
    const by = [...new Set(c.fills.map((f) => f.merchant_name))].join(' and ')
    out.push({ kind: 'supply', who: c.fills[0].merchant, text: `${by} ${c.side === 'buy' ? 'supplied' : 'bought'} ${qty} ${NAME[c.resource]} ${c.side === 'buy' ? 'to' : 'from'} ${c.requester_name}.`, tick })
  }
  for (const r of radioFromDecisions(o.decisions.filter((d) => d.tick > last.tick))) {
    // a faction's order is already told by the supply line; keep its bounties and responses
    if (/Resupply is ordered|We are buying/.test(r.text)) continue
    out.push({ kind: 'decision', who: r.speaker, text: r.text, tick: r.tick })
  }
  // readiness first (it is what changed about the world), then the newest events
  const rank = { readiness: 0, operation: 1, supply: 2, decision: 3 } as const
  out.sort((a, b) => rank[a.kind] - rank[b.kind] || (b.tick ?? 0) - (a.tick ?? 0))
  return out.slice(0, o.max ?? 4)
}
