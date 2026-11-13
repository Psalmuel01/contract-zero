import { describe, expect, it } from 'vitest'
import type { AgentEvent, OperationRecord, ProcurementChain } from '@/lib/api'
import { sinceVisit } from '../sinceVisit'

const chain = (order: number, tick: number): ProcurementChain => ({
  order, chain_id: `c${order}`, requester: 'vanguard', requester_name: 'Vanguard', side: 'buy', resource: 'med', qty: 7, limit_total: 400, urgency: 1, placed_at: tick - 1, expires_at: tick + 5,
  status: { status: 'filled' }, purpose: 'restock', raid: null, shortage: null, answers: [], choices: [],
  fills: [{ merchant: 'halcyon', merchant_name: 'Halcyon Logistics', qty: 7, total: 317, tick }],
  settlement: [], delivered: 7, paid: 317, next_mission: null, execution_path: { kind: 'native', label: '', official_near_intents: false },
})
const op = (at: string, outcome: OperationRecord['outcome'] = 'extracted'): OperationRecord => ({
  player: 'p', completed_at: at, outcome, reason: null, kind: 'raid', resource: 'ammo', target: 'ashen', extracted_units: 30, bounty: 0,
  consequence: {} as OperationRecord['consequence'], decisions: [], settlement: null,
})
const bounty = (seq: number, tick: number): AgentEvent => ({
  seq, tick, source: 'agent:ashen', kind: 'agent_decision',
  payload: { validation: 'accepted', trigger: 'retaliation', action: { action: 'post_bounty', target: 'vanguard', resource: 'fuel', amount: 777 }, rationale: 'x' },
} as unknown as AgentEvent)

describe('since you were last here', () => {
  const last = { tick: 100, at: Date.parse('2026-11-10T10:00:00Z'), readiness: { vanguard: 'Operational', ashen: 'Operational' } }
  const readiness = { vanguard: { name: 'Vanguard', label: 'Under Pressure' }, ashen: { name: 'Ashen Compact', label: 'Operational' } }

  it('says nothing on a first visit: there is no last look to compare against', () => {
    expect(sinceVisit({ last: null, readiness, decisions: [], chains: [chain(1, 120)], operations: [] })).toEqual([])
  })

  it('reports only records newer than the last look, readiness changes first', () => {
    const d = sinceVisit({
      last, readiness,
      decisions: [bounty(5, 90), bounty(6, 130)],
      chains: [chain(1, 90), chain(2, 120)],
      operations: [op('2026-11-10T09:00:00Z'), op('2026-11-10T11:00:00Z')],
    })
    expect(d[0]).toMatchObject({ kind: 'readiness', who: 'vanguard', text: 'Vanguard: Operational → Under Pressure.' })
    expect(d.filter((x) => x.kind === 'supply')).toHaveLength(1)
    expect(d.find((x) => x.kind === 'supply')!.text).toBe('Halcyon Logistics supplied 7 medicine to Vanguard.')
    expect(d.filter((x) => x.kind === 'operation')).toHaveLength(1)
    expect(d.find((x) => x.kind === 'operation')!.text).toBe("An operator raided Ashen Compact's ammunition, 30 units carried out.")
    expect(d.filter((x) => x.kind === 'decision')).toHaveLength(1)
    expect(d.find((x) => x.kind === 'decision')!.text).toContain('777 credits')
  })

  it('an unchanged readiness is not news', () => {
    const d = sinceVisit({ last, readiness: { vanguard: { name: 'Vanguard', label: 'Operational' } }, decisions: [], chains: [], operations: [] })
    expect(d).toEqual([])
  })

  it('keeps the update short', () => {
    const d = sinceVisit({ last, readiness, decisions: [], chains: [1, 2, 3, 4, 5, 6].map((i) => chain(i, 100 + i)), operations: [] })
    expect(d.length).toBe(4)
  })
})
