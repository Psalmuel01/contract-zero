import { describe, expect, it } from 'vitest'
import { impactSurface, surfaceForKind } from '../impactSurface'
import { LEVELS } from '../../fps/levels'
import type { Kind } from '../../fps/levels'

const ctxFor = (id: keyof typeof LEVELS) => {
  const L = LEVELS[id]
  return { cover: L.cover, walls: L.walls, floor: L.floor.kind, roads: L.art.filter((a) => a.kind === 'road').map((a) => ({ x: a.x, z: a.z, w: a.w ?? 6, d: a.d ?? 40 })) }
}
const side = [1, 0, 0] as [number, number, number]
const up = [0, 1, 0] as [number, number, number]

describe('what a round goes through', () => {
  it('every collider kind in every level maps to a real surface', () => {
    for (const L of Object.values(LEVELS)) for (const b of [...L.walls, ...L.cover]) expect(surfaceForKind(b.kind as Kind), `${L.id} ${b.kind}`).not.toBeNull()
  })
  it('a steel tank sparks, a crate splinters, a barrier powders', () => {
    const cy = ctxFor('cinder_yard')
    const tank = LEVELS.cinder_yard.cover.find((b) => b.kind === 'tank')!
    expect(impactSurface([tank.x + tank.w / 2, 2, tank.z], side, cy)).toBe('metal')
    const dd = ctxFor('dustline_depot')
    const crate = LEVELS.dustline_depot.cover.find((b) => b.kind === 'crate')!
    expect(impactSurface([crate.x + crate.w / 2, 0.5, crate.z], side, dd)).toBe('wood')
    const barrier = LEVELS.dustline_depot.cover.find((b) => b.kind === 'barrier')!
    expect(impactSurface([barrier.x, 0.6, barrier.z + barrier.d / 2], side, dd)).toBe('concrete')
    const warehouse = LEVELS.dustline_depot.walls.find((b) => b.kind === 'warehouse')!
    expect(impactSurface([warehouse.x, 3, warehouse.z + warehouse.d / 2], side, dd)).toBe('metal')
  })
  it('the ground is earth on an earth site, concrete on a paved one or a road', () => {
    expect(impactSurface([20, 0.01, 10], up, ctxFor('dustline_depot'))).toBe('dirt')
    expect(impactSurface([0, 0.01, -18], up, ctxFor('dustline_depot'))).toBe('concrete') // the road
    expect(impactSurface([0, 0.01, 10], up, ctxFor('blacksite'))).toBe('concrete')
  })
  it('campaign arenas without kinds keep the old split', () => {
    const arena = { cover: [{ x: 0, z: 0, w: 2, d: 2, h: 1 }], walls: [{ x: 5, z: 0, w: 1, d: 10, h: 3 }] }
    expect(impactSurface([1, 0.5, 0], side, arena)).toBe('wood')
    expect(impactSurface([4.5, 1, 0], side, arena)).toBe('concrete')
    expect(impactSurface([2, 0.01, 2], up, arena)).toBe('dirt')
  })
})
