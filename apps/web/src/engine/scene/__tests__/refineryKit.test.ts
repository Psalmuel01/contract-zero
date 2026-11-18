import { describe, expect, it } from 'vitest'
import { buildTank, buildColumn, buildRackDetail, buildFlareStack, buildLoadingArm, buildWallServices, footprintViolations, kitTriangles, mergeKit, HEAD_CLEAR } from '../refineryKit'
import * as THREE from 'three'
import { CINDER_YARD } from '../../fps/cinderYard'
import { LEVELS } from '../../fps/levels'
import { buildSiteKit } from '../RefineryArt'

describe('the refinery kit', () => {
  const tanks = CINDER_YARD.cover.filter((b) => b.kind === 'tank')
  const columns = CINDER_YARD.cover.filter((b) => b.kind === 'column')
  const racks = CINDER_YARD.cover.filter((b) => b.kind === 'pipe_rack')

  it('keeps every tank attachment inside its collider below head height', () => {
    for (const t of tanks) {
      const k = buildTank({ x: t.x, z: t.z, size: t.w, height: t.h })
      expect(footprintViolations(k, t.x, t.z, t.w / 2)).toBe(0)
    }
  })
  it('keeps every column attachment inside its collider below head height', () => {
    for (const c of columns) {
      const k = buildColumn({ x: c.x, z: c.z, size: c.w, height: c.h })
      expect(footprintViolations(k, c.x, c.z, c.w / 2)).toBe(0)
    }
  })
  it('rack detail stays within the rack', () => {
    for (const r of racks) {
      const k = buildRackDetail({ x: r.x, z: r.z, w: r.w, d: r.d, h: r.h })
      const alongZ = r.d > r.w
      // A rack is long and thin: check each axis against its own half size.
      const v = new THREE.Vector3()
      let bad = 0, example = ''
      for (const [m, gs] of Object.entries(k)) for (const g of gs ?? []) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (v.y < HEAD_CLEAR && (Math.abs(v.x - r.x) > r.w / 2 + 0.1 || Math.abs(v.z - r.z) > r.d / 2 + 0.1)) { bad++; example = `${m} at ${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}` } } }
      expect(bad, `${alongZ ? 'z' : 'x'} rack at ${r.x},${r.z}: ${example}`).toBe(0)
    }
  })
  it('stays inside a triangle budget per module and merges to a few draws', () => {
    const tank = buildTank({ x: 0, z: 0, size: 7, height: 8 })
    const column = buildColumn({ x: 0, z: 0, size: 3, height: 16 })
    expect(kitTriangles(tank)).toBeLessThan(14_000)
    expect(kitTriangles(column)).toBeLessThan(14_000)
    const merged = mergeKit([tank, column])
    expect(Object.keys(merged).length).toBeLessThanOrEqual(7)
    for (const g of Object.values(merged)) { expect(g!.boundingSphere!.radius).toBeGreaterThan(0); g!.dispose() }
  })
  it('the flare derrick stands on its base collider; the drum is inside it', () => {
    const base = CINDER_YARD.cover.find((b) => b.kind === 'concrete' && b.x === 25)!
    const stack = CINDER_YARD.art.find((a) => a.kind === 'stack')!
    const k = buildFlareStack({ x: stack.x, z: stack.z, height: stack.h ?? 22 })
    expect(footprintViolations(k, base.x, base.z, base.w / 2, 0.1)).toBe(0)
    expect(kitTriangles(k)).toBeLessThan(9_000)
  })
  it('wall services hang above head height and never leave the wall below it', () => {
    const wall = CINDER_YARD.walls.find((b) => b.kind === 'concrete' && b.w > 20)!
    const k = buildWallServices({ ...wall, face: '+z' })
    expect(footprintViolations(k, wall.x, wall.z, Math.max(wall.w, wall.d) / 2)).toBe(0)
    let lowest = Infinity
    for (const gs of Object.values(k)) for (const g of gs ?? []) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) lowest = Math.min(lowest, p.getY(i)) }
    expect(lowest).toBeGreaterThan(HEAD_CLEAR)
  })
  it('the loading arm crosses the lane only above head height', () => {
    const k = buildLoadingArm({ from: [14.4, -10.6], to: [10.8, 3.0, -11.5] })
    const v = new THREE.Vector3()
    for (const gs of Object.values(k)) for (const g of gs ?? []) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (v.y < HEAD_CLEAR) expect(Math.hypot(v.x - 14.4, v.z + 10.6)).toBeLessThan(0.7) } }
  })
  it('every site kit respects every collider footprint below head height', () => {
    for (const level of Object.values(LEVELS)) {
      const parts = buildSiteKit(level)
      if (!parts.length) continue // the Blacksite has no plant
      const boxes = [...level.walls, ...level.cover]
      // Each part belongs to a collider; the union check: no vertex below head height
      // may lie outside EVERY collider's footprint (a vertex inside some box is fine).
      let bad = 0
      const v = new THREE.Vector3()
      for (const k of parts) for (const gs of Object.values(k)) for (const g of gs ?? []) {
        const p = g.attributes.position
        for (let i = 0; i < p.count; i += 3) {
          v.fromBufferAttribute(p, i)
          if (v.y >= HEAD_CLEAR || v.y < -0.3) continue
          const inside = boxes.some((b) => Math.abs(v.x - b.x) <= b.w / 2 + 0.1 && Math.abs(v.z - b.z) <= b.d / 2 + 0.1)
          const underArm = Math.hypot(v.x - 14.4, v.z + 10.6) < 0.7 && level.id === 'cinder_yard'
          if (!inside && !underArm) bad++
        }
      }
      expect(bad, level.id).toBeLessThanOrEqual(0)
    }
  })
})
