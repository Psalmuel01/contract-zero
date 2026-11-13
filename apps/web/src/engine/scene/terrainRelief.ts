import * as THREE from 'three'
import type { LevelDef } from '../fps/levels'

/** Where the relief starts rising, in metres outside the playable bounds. The site's
 * perimeter wall stands 15 m out (siteLook.perimeterWall); rising any nearer buried
 * its base under a ramp. Never displace walkable ground without teaching the
 * simulation the same height. */
export const RELIEF_FROM = 20
export function terrainHeight(level: LevelDef, x: number, z: number): number {
  const b = level.bounds
  const dx = Math.max(b.minX - x, 0, x - b.maxX)
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ)
  const distance = Math.hypot(dx, dz)
  const t = THREE.MathUtils.smoothstep(distance, RELIEF_FROM, RELIEF_FROM + 30)
  const wave = .5 + .26 * Math.sin(x * .091 + z * .071) + .15 * Math.cos(z * .17 - x * .043)
  const height = level.id === 'dustline_depot' ? 3.2 : level.id === 'blacksite' ? 4.6 : 1.8
  return -.065 + t * height * wave
}

/** `ground` is the colour the apron meets the yard with (the site's graded floor tint
 * through its haze); it darkens a little up the slopes. */
export function buildTerrainApron(level: LevelDef, minimal = false, ground?: string): THREE.PlaneGeometry {
  const b = level.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2
  const width = b.maxX - b.minX + 190, depth = b.maxZ - b.minZ + 190
  const n = minimal ? 28 : 48 // 4.6k triangles: the relief is broad, 72 cost 10k for no visible gain
  const geo = new THREE.PlaneGeometry(width, depth, n, n)
  geo.rotateX(-Math.PI / 2);geo.translate(cx, 0, cz)
  const p = geo.attributes.position
  const colors = new Float32Array(p.count * 3)
  const a = new THREE.Color(ground ?? (level.id === 'dustline_depot' ? '#9a8564' : level.id === 'blacksite' ? '#535e59' : '#615448'))
  const c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    const x=p.getX(i), z=p.getZ(i)
    p.setY(i, terrainHeight(level, x, z))
    const slope = Math.max(0, terrainHeight(level, x, z)) / 5
    const variation = (.9 + .1 * Math.sin(x * .19) * Math.cos(z * .13)) * (1 - .25 * slope)
    c.copy(a).multiplyScalar(variation);c.toArray(colors,i*3)
  }
  geo.setAttribute('color',new THREE.BufferAttribute(colors,3))
  geo.computeVertexNormals();geo.computeBoundingSphere()
  return geo
}
