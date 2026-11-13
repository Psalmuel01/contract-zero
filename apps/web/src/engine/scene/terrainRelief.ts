import * as THREE from 'three'
import type { LevelDef } from '../fps/levels'

/** Visual relief begins outside the playable/collision footprint plus a 5 m apron.
 * Never displace walkable ground without teaching the simulation the same height. */
export function terrainHeight(level: LevelDef, x: number, z: number): number {
  const b = level.bounds
  const dx = Math.max(b.minX - x, 0, x - b.maxX)
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ)
  const distance = Math.hypot(dx, dz)
  const t = THREE.MathUtils.smoothstep(distance, 5, 32)
  const wave = .5 + .26 * Math.sin(x * .091 + z * .071) + .15 * Math.cos(z * .17 - x * .043)
  const height = level.id === 'dustline_depot' ? 3.2 : level.id === 'blacksite' ? 4.6 : 1.8
  return -.065 + t * height * wave
}

export function buildTerrainApron(level: LevelDef, minimal = false): THREE.PlaneGeometry {
  const b = level.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2
  const width = b.maxX - b.minX + 190, depth = b.maxZ - b.minZ + 190
  const n = minimal ? 28 : 72
  const geo = new THREE.PlaneGeometry(width, depth, n, n)
  geo.rotateX(-Math.PI / 2);geo.translate(cx, 0, cz)
  const p = geo.attributes.position
  const colors = new Float32Array(p.count * 3)
  const a = new THREE.Color(level.id === 'dustline_depot' ? '#9a8564' : level.id === 'blacksite' ? '#535e59' : '#615448')
  const c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    const x=p.getX(i), z=p.getZ(i)
    p.setY(i, terrainHeight(level, x, z))
    const variation = .88 + .12 * Math.sin(x * .19) * Math.cos(z * .13)
    c.copy(a).multiplyScalar(variation);c.toArray(colors,i*3)
  }
  geo.setAttribute('color',new THREE.BufferAttribute(colors,3))
  geo.computeVertexNormals();geo.computeBoundingSphere()
  return geo
}
