import { describe, expect, it } from 'vitest'
import { sandBanks } from '../SiteDressing'
import { LEVELS } from '../../fps/levels'

// Seeded like the Wear layer: deterministic placements to check.
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

describe('sand banked against Dustline walls', () => {
  const level = LEVELS.dustline_depot
  it('banks along real walls, long and narrow', () => {
    for (const seed of [1, 7, 1077]) {
      const banks = sandBanks(level, rng(seed))
      expect(banks.length).toBeGreaterThan(4)
      for (const b of banks) {
        expect(b.l).toBeGreaterThan(b.s) // a drift runs along the wall
        const nearWall = level.walls.some((w) => (w.kind === 'container' || w.kind === 'warehouse')
          && Math.abs(b.x - w.x) <= w.w / 2 + b.s && Math.abs(b.z - w.z) <= w.d / 2 + b.s)
        expect(nearWall).toBe(true)
      }
    }
  })
  it('never lies over a pickup, an objective, a cargo case or the extraction zone', () => {
    const f = level.field
    const spots: [number, number, number][] = [
      ...Object.values(level.points).flatMap((p) => (Array.isArray(p[0]) ? (p as [number, number][]) : [p as [number, number]])).map(([x, z]) => [x, z, 0.8] as [number, number, number]),
      ...[...f.cases, ...f.ammo, ...f.med, f.seized].map(([x, z]) => [x, z, 0.8] as [number, number, number]),
      [f.exfil.pos[0], f.exfil.pos[1], f.exfil.radius],
    ]
    for (const seed of [1, 7, 1077, 4242]) {
      for (const b of sandBanks(level, rng(seed))) {
        const alongX = b.ry !== 0
        const hx = (alongX ? b.l : b.s) / 2, hz = (alongX ? b.s : b.l) / 2
        for (const [x, z, r] of spots) expect(Math.hypot(Math.max(0, Math.abs(x - b.x) - hx), Math.max(0, Math.abs(z - b.z) - hz))).toBeGreaterThanOrEqual(r)
      }
    }
  })
  it('only Dustline gets them', () => {
    expect(sandBanks(LEVELS.blacksite, rng(1))).toEqual([])
    expect(sandBanks(LEVELS.cinder_yard, rng(1))).toEqual([])
  })
})
