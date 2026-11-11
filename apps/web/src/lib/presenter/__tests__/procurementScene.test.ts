import { describe, expect, it } from 'vitest'
import type { ProcurementChain } from '@/lib/api'
import { procurementScene, sceneAt } from '../procurementScene'

const chain = (over: Partial<ProcurementChain> = {}): ProcurementChain => ({
  order: 7, chain_id: 'cz-7', requester: 'vanguard', requester_name: 'Vanguard', side: 'buy', resource: 'med', qty: 7, limit_total: 400, urgency: 2, placed_at: 100, expires_at: 106,
  status: { status: 'filled' }, purpose: 'restock', raid: null,
  shortage: { tick: 100, trigger: 'med below target', context: [['have', 17], ['target', 24]], rationale: 'Med 17/24', planner: 'fallback' },
  answers: [
    { tick: 101, merchant: 'halcyon', merchant_name: 'Halcyon Logistics', proposed: true, validation: 'accepted', rationale: 'Offer 7', planner: 'fallback' },
    { tick: 101, merchant: 'vex', merchant_name: 'Vex Exchange', proposed: true, validation: 'accepted', rationale: 'Offer 7', planner: 'fallback' },
  ],
  choices: [{ tick: 102, action: { action: 'accept' }, rationale: 'Cheapest per unit.', validation: 'accepted', error: null }],
  fills: [{ merchant: 'halcyon', merchant_name: 'Halcyon Logistics', qty: 7, total: 317, tick: 102 }],
  settlement: [{ op_id: 'fill:o7', kind: 'order_fill', status: 'confirmed', settled_on_chain: true, tx_hashes: ['abc'], explorer: [], error: null }],
  delivered: 7, paid: 317,
  next_mission: { depot: 'med', guards: 7, planned: 9, rifles: 5, sidearms: 2, defense: 2, stock_now: 24 },
  execution_path: { kind: 'native', label: 'x', official_near_intents: false },
  ...over,
})

describe('a supply order on the War Table', () => {
  it('shows an arc for each merchant that offered and a solid one for the winner', () => {
    const s = procurementScene(chain())
    expect(s.offered.sort()).toEqual(['halcyon', 'vex'])
    expect(s.winners).toEqual(['halcyon'])
    expect(s.contested).toBe(true)
    expect(s.settlement).toBe('confirmed')
    const end = sceneAt(s, s.beats.length - 1)
    expect(end).toMatchObject({ flare: true, order: true, won: ['halcyon'], crate: true })
  })

  it('a lone offer is one arc and never a contest', () => {
    const s = procurementScene(chain({ answers: [chain().answers[0], { ...chain().answers[1], proposed: false }] }))
    expect(s.offered).toEqual(['halcyon'])
    expect(s.declined).toEqual(['vex'])
    expect(s.contested).toBe(false)
    expect(s.beats.find((b) => b.key === 'bids')!.summary).toContain('no price competition')
  })

  it('draws no crate when nothing was delivered, and no winner when nobody filled', () => {
    const s = procurementScene(chain({ status: { status: 'expired' }, fills: [], delivered: 0, paid: 0, settlement: [] }))
    expect(s.winners).toEqual([])
    const end = sceneAt(s, s.beats.length - 1)
    expect(end.crate).toBe(false)
    expect(end.won).toEqual([])
    expect(s.settlement).toBe('no on-chain record')
    expect(s.beats.map((b) => b.key)).not.toContain('arrival')
  })

  it('never calls a settlement confirmed while a step is still in flight', () => {
    const s = procurementScene(chain({ settlement: [
      { op_id: 'a', kind: 'order_place', status: 'confirmed', settled_on_chain: true, tx_hashes: [], explorer: [], error: null },
      { op_id: 'b', kind: 'order_fill', status: 'submitted', settled_on_chain: false, tx_hashes: [], explorer: [], error: null },
    ] }))
    expect(s.settlement).toBe('in flight')
  })

  it('builds the table up beat by beat: arcs only once the bids are in', () => {
    const s = procurementScene(chain())
    const i = s.beats.findIndex((b) => b.key === 'order')
    expect(sceneAt(s, i).arcs).toEqual([])
    expect(sceneAt(s, i + 1).arcs.length).toBe(2)
  })
})
