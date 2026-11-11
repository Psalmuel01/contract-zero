import { describe, expect, it } from 'vitest'
import { LEVELS, type LevelId } from '../../fps/levels'
import { ZONE_THEMES } from '../../fps/campaign'
import { LANDMARKS, MARKS, SIGN_WORDS, TERRAIN, perimeterWall, airborne, gradeTheme, groundWear, mixHex, type Mark } from '../siteLook'

const IDS = Object.keys(LEVELS) as LevelId[]

/** Does this mark sit flat on the matching face of a real wall, inside its extent? */
function onAWall(level: LevelId, m: Mark): boolean {
  const lv = LEVELS[level]
  return [...lv.walls, ...lv.cover].some((b) => {
    const half = { x: b.w / 2, z: b.d / 2 }
    const axis = m.facing[1] as 'x' | 'z'
    const sign = m.facing[0] === '+' ? 1 : -1
    const face = (axis === 'x' ? b.x : b.z) + sign * half[axis]
    const along = axis === 'x' ? 'z' : 'x'
    const c = along === 'x' ? b.x : b.z
    const pos = along === 'x' ? m.x : m.z
    const flush = Math.abs((axis === 'x' ? m.x : m.z) - face) < 0.05
    const inside = pos - m.w / 2 >= c - half[along] - 0.01 && pos + m.w / 2 <= c + half[along] + 0.01
    const tallEnough = m.y + m.h / 2 <= b.h + 0.01 && m.y - m.h / 2 >= -0.01
    return flush && inside && tallEnough
  })
}

describe('site look', () => {
  it('every painted mark sits on a real wall face, within the wall', () => {
    for (const id of IDS) for (const m of MARKS[id]) expect(onAWall(id, m), `${id} ${m.kind} ${m.text ?? ''} at ${m.x},${m.y},${m.z}`).toBe(true)
  })

  it('every landmark stands outside the playable bounds, so nothing solid-looking is walk-through', () => {
    for (const id of IDS) {
      const b = LEVELS[id].bounds
      for (const l of LANDMARKS[id]) {
        if (l.kind === 'perimeter_wall' || l.kind === 'flag') continue // drawn around / just beyond the fence by construction
        const inside = l.x > b.minX - 6 && l.x < b.maxX + 6 && l.z > b.minZ - 6 && l.z < b.maxZ + 6
        expect(inside, `${id} ${l.kind} at ${l.x},${l.z}`).toBe(false)
      }
    }
  })

  it('the land beyond never rises more than 16 degrees from anywhere a player can stand', () => {
    // A taller ring fills the view through a gate as one flat wall (it did, on the Blacksite).
    for (const id of IDS) {
      const b = LEVELS[id].bounds
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2
      const corner = Math.hypot(b.maxX - cx, b.maxZ - cz)
      for (const [R, base, relief] of TERRAIN[id].rings) {
        const deg = (Math.atan((base + relief) / (R - corner)) * 180) / Math.PI
        expect(deg, `${id} ring ${R}`).toBeLessThanOrEqual(16)
      }
    }
  })

  it('no piece of the outer perimeter wall reaches into the site', () => {
    for (const id of IDS) {
      const b = LEVELS[id].bounds
      for (const p of perimeterWall(b)) {
        const overlapX = p.x + p.w / 2 > b.minX && p.x - p.w / 2 < b.maxX
        const overlapZ = p.z + p.d / 2 > b.minZ && p.z - p.d / 2 < b.maxZ
        expect(overlapX && overlapZ, `${id} box at ${p.x},${p.z} size ${p.w}x${p.d}`).toBe(false)
      }
    }
  })

  it('flags stand outside the fence line', () => {
    for (const id of IDS) for (const l of LANDMARKS[id].filter((x) => x.kind === 'flag')) expect(l.z).toBeGreaterThan(LEVELS[id].bounds.maxZ)
  })

  it('names only signs that exist, and every banner sign has words', () => {
    for (const id of IDS) {
      const banners = LEVELS[id].art.filter((a) => a.kind === 'sign' && a.w).map((a) => `${a.x},${a.z}`)
      expect(Object.keys(SIGN_WORDS[id]).sort()).toEqual(banners.sort())
    }
  })

  it('grades the hour toward the site without touching how bright it is', () => {
    const day = ZONE_THEMES.DUSTLINE
    const a = gradeTheme(day, 'dustline_depot', 'day'), b = gradeTheme(day, 'blacksite', 'day'), c = gradeTheme(day, 'cinder_yard', 'day')
    expect(new Set([a.fog[0], b.fog[0], c.fog[0]]).size).toBe(3) // three different airs under one sun
    for (const g of [a, b, c]) {
      expect(g.sun).toEqual(day.sun)
      expect(g.ambient).toBe(day.ambient)
      expect(g.fog[2]).toBeLessThanOrEqual(day.fog[2])
    }
  })

  it('mixes colours linearly', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#102030', '#102030', 0.3)).toBe('#102030')
  })

  it('rain only at night on the Blacksite; dust and ash on the others', () => {
    expect(airborne('blacksite', 'night').map((p) => p.kind)).toEqual(['rain'])
    expect(airborne('blacksite', 'day')).toEqual([])
    expect(airborne('dustline_depot', 'day')[0].kind).toBe('dust')
    expect(airborne('cinder_yard', 'dusk')[0].kind).toBe('ash')
    for (const id of IDS) expect(groundWear(id, 'day').length).toBeGreaterThan(0)
  })
})
