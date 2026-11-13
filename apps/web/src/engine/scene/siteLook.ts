/**
 * How each site looks, separate from the hour.
 *
 * The time of day (day / dusk / night) picks the base light (fps/campaign ZONE_THEMES).
 * Until now that was ALL that varied, so a daytime Blacksite wore Dustline's sky and a
 * night Dustline wore Blacksite's. This layer grades the hour's light toward each
 * site's own air, and describes the visual-only pieces that make each place itself:
 * the land beyond the fence, the landmarks on the horizon, painted signage and marks,
 * ground wear and what drifts in the air. None of it collides; anything solid-looking
 * stands outside the playable bounds, and everything inside is flat paint or overhead.
 *
 *  - DUSTLINE DEPOT (Vanguard): open desert logistics. Warm ochre dust, mesas, a water
 *    tower and a radio mast over a motor pool; dust blowing across the yard.
 *  - BLACKSITE (Vanguard): restricted research. Cold steel air, a dark ridge, a tall
 *    perimeter wall with towers and searchlights; haze by day, rain at night.
 *  - CINDER YARD (Ashen Compact): contested heavy industry. Smog, a cooling tower and
 *    chimneys smoking on the skyline, soot underfoot, ash and embers in the air.
 */

import type { LevelId } from '../fps/levels'
import type { ZoneTheme } from '../fps/campaign'

export type Phase = 'day' | 'dusk' | 'night'

/** The site's own air, per hour: what the hour's light is pulled toward. */
interface Air {
  /** Fog / horizon haze colour. */
  haze: string
  /** Sky colour at the horizon. */
  horizon: string
  /** Light bounced up from the ground. */
  ground: string
  /** Floor and wall tint. */
  dirt: string
  /** How far the haze comes in (x the hour's fog distances). */
  thick: number
  /** How strongly this site's air replaces the hour's (0..1). */
  mix: number
  /** How far the zenith is pulled toward the haze (smog over the refinery, overcast). */
  zenith: number
}

const AIR: Record<LevelId, Record<Phase, Air>> = {
  dustline_depot: {
    day: { haze: '#d8c3a0', horizon: '#e3d1b0', ground: '#8a6a46', dirt: '#b9a284', thick: 0.86, mix: 0.55, zenith: 0.08 },
    dusk: { haze: '#c98e5c', horizon: '#eaa868', ground: '#5a4128', dirt: '#a08668', thick: 0.86, mix: 0.5, zenith: 0.05 },
    night: { haze: '#1c2232', horizon: '#2a3448', ground: '#141210', dirt: '#5e5a54', thick: 0.95, mix: 0.4, zenith: 0.0 },
  },
  blacksite: {
    day: { haze: '#a9b6bd', horizon: '#c3ced3', ground: '#3d4448', dirt: '#8e9398', thick: 0.72, mix: 0.6, zenith: 0.35 },
    dusk: { haze: '#8a8e9e', horizon: '#b49b93', ground: '#2a2c33', dirt: '#7c7f86', thick: 0.75, mix: 0.5, zenith: 0.25 },
    night: { haze: '#0c1820', horizon: '#14283a', ground: '#0b0f12', dirt: '#4b5056', thick: 0.8, mix: 0.45, zenith: 0.1 },
  },
  cinder_yard: {
    day: { haze: '#a88c74', horizon: '#c4a586', ground: '#4a3a2e', dirt: '#8f8478', thick: 0.7, mix: 0.6, zenith: 0.5 },
    dusk: { haze: '#9c5c3c', horizon: '#d47a44', ground: '#3a2418', dirt: '#86766a', thick: 0.72, mix: 0.6, zenith: 0.4 },
    night: { haze: '#231612', horizon: '#3e2116', ground: '#120c0a', dirt: '#55504c', thick: 0.82, mix: 0.5, zenith: 0.25 },
  },
}

const hex = (h: string): [number, number, number] => {
  const v = parseInt(h.replace('#', ''), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
const toHex = ([r, g, b]: [number, number, number]) =>
  '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')
/** Linear blend of two hex colours. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hex(a), y = hex(b)
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

export function airFor(level: LevelId, phase: Phase): Air {
  return AIR[level][phase]
}

/** The hour's theme, graded toward the site's own air. Light intensities are untouched:
 *  the hour still decides how bright it is; the site decides what the air is like. */
export function gradeTheme(theme: ZoneTheme, level: LevelId, phase: Phase): ZoneTheme {
  const a = AIR[level][phase]
  const m = a.mix
  return {
    ...theme,
    bg: mixHex(theme.bg, a.haze, m),
    fog: [mixHex(theme.fog[0], a.haze, m), theme.fog[1] * a.thick, theme.fog[2] * a.thick],
    hemi: [mixHex(theme.hemi[0], a.haze, m * 0.3), mixHex(theme.hemi[1], a.ground, m), theme.hemi[2]],
    floorTint: mixHex(theme.floorTint, a.dirt, m * 0.8),
    wallTint: mixHex(theme.wallTint, a.dirt, m * 0.5),
    sky: { top: mixHex(theme.sky.top, a.haze, a.zenith), bottom: mixHex(theme.sky.bottom, a.horizon, m) },
  }
}

// ── Signage ─────────────────────────────────────────────────────────────────

/** Words for a banner sign (level art `sign` with a width), front (+z/+x) and back. */
export interface SignWords { title: string; line: string }

/** By level, keyed by the sign's position so a layout change can't silently misname one. */
export const SIGN_WORDS: Record<LevelId, Record<string, { front: SignWords; back: SignWords }>> = {
  dustline_depot: {
    '0,16.7': {
      front: { title: 'DUSTLINE DEPOT', line: 'LOGISTICS COMMAND · AUTHORISED VEHICLES ONLY' },
      back: { title: 'SOUTH GATE', line: 'SIGN OUT ALL CARGO · SPEED LIMIT 15' },
    },
  },
  blacksite: {
    '1.75,-13': {
      front: { title: 'CONTROL', line: 'AUTHORISED STAFF ONLY' },
      back: { title: 'CONTROL', line: 'AUTHORISED STAFF ONLY' },
    },
  },
  cinder_yard: {
    '0,12.4': {
      front: { title: 'CINDER YARD', line: 'REFINERY · NO NAKED FLAME BEYOND THIS POINT' },
      back: { title: 'CHECKPOINT', line: 'TANKERS STOP · ALL HANDS SHOW PASSES' },
    },
  },
}

// ── Painted marks on real wall faces ────────────────────────────────────────

/** A flat painted mark on a wall face: the holder's insignia, or stencilled words.
 *  `facing` is the face's outward normal. Positions are tested against the colliders
 *  so a mark always sits on a real wall (siteLook.test). */
export interface Mark {
  x: number; y: number; z: number
  facing: '+z' | '-z' | '+x' | '-x'
  w: number; h: number
  kind: 'insignia' | 'stencil' | 'hazard'
  text?: string
  /** Paint colour; insignia default to the holder's colour, stencils to off-white. */
  color?: string
}

export const MARKS: Record<LevelId, Mark[]> = {
  dustline_depot: [
    // the warehouse's south wall, facing the yard: the holder's mark and the building's number
    { x: -22, y: 4.2, z: -23.79, facing: '+z', w: 3.2, h: 3.2, kind: 'insignia' },
    { x: -10, y: 4.6, z: -23.79, facing: '+z', w: 6.5, h: 1.3, kind: 'stencil', text: 'WH-2 · MUNITIONS' },
    { x: -10, y: 1.1, z: -23.79, facing: '+z', w: 5.5, h: 0.5, kind: 'hazard' },
    // the warehouse's east wall, seen from the yard road
    { x: -5.79, y: 4.6, z: -42, facing: '+x', w: 7, h: 1.2, kind: 'stencil', text: 'NO ENTRY · ARMED STORES' },
  ],
  blacksite: [
    // the facade facing the courtyard: the facility's designation under the catwalk
    { x: 9, y: 2.0, z: 2.31, facing: '+z', w: 5.5, h: 1.5, kind: 'stencil', text: 'B-7' },
    { x: 15, y: 2.0, z: 2.31, facing: '+z', w: 1.8, h: 1.8, kind: 'insignia' },
    { x: -6.5, y: 2.2, z: 2.31, facing: '+z', w: 6.5, h: 0.75, kind: 'stencil', text: 'RESTRICTED AREA · ESCORT REQUIRED', color: '#e8d9a8' },
    // the perimeter wall, seen looking back at the gate
    { x: -12, y: 2.6, z: 21.19, facing: '-z', w: 9, h: 1.0, kind: 'stencil', text: 'SECURITY ZONE · USE OF FORCE AUTHORISED', color: '#e8d9a8' },
    { x: 12, y: 2.6, z: 21.19, facing: '-z', w: 2.2, h: 2.2, kind: 'insignia' },
  ],
  cinder_yard: [
    // the blast wall, facing the tank farm
    { x: -15, y: 2.0, z: -17.49, facing: '+z', w: 2.6, h: 2.6, kind: 'insignia' },
    { x: 17, y: 2.4, z: -17.49, facing: '+z', w: 10, h: 1.0, kind: 'stencil', text: 'NO NAKED FLAME · HOT WORK BY PERMIT' },
    { x: 17, y: 1.0, z: -17.49, facing: '+z', w: 10, h: 0.5, kind: 'hazard' },
    { x: -15, y: 0.45, z: -17.49, facing: '+z', w: 9, h: 0.4, kind: 'hazard' },
  ],
}

// ── The land and the skyline beyond the fence ───────────────────────────────

/** A distant set piece, placed outside the playable bounds (tested). */
export interface Landmark {
  kind: 'water_tower' | 'radio_mast' | 'quonset' | 'berm' | 'perimeter_wall' | 'guard_tower' | 'dish' | 'cooling_tower' | 'chimney' | 'refinery' | 'pipe_bridge' | 'flag'
  x: number; z: number
  /** Size scale (1 = authored). */
  s?: number
  rot?: number
  /** Searchlight on a guard tower; smoke from a chimney or cooling tower. */
  active?: boolean
}

export const LANDMARKS: Record<LevelId, Landmark[]> = {
  dustline_depot: [
    { kind: 'water_tower', x: -44, z: -8 },
    { kind: 'radio_mast', x: 46, z: -30 },
    { kind: 'quonset', x: 52, z: 4, rot: 0.2 }, { kind: 'quonset', x: 56, z: -10, rot: 0.2 }, { kind: 'quonset', x: 60, z: -24, rot: 0.2 },
    { kind: 'berm', x: -46, z: -40, s: 1.4 }, { kind: 'berm', x: 0, z: -72, s: 2.2 }, { kind: 'berm', x: 40, z: -66, s: 1.6 }, { kind: 'berm', x: -30, z: 34, s: 1.5 },
    { kind: 'flag', x: -6, z: 18.6 }, { kind: 'flag', x: 6, z: 18.6 },
  ],
  blacksite: [
    { kind: 'perimeter_wall', x: 0, z: 0 },
    { kind: 'guard_tower', x: -34, z: 30, active: true }, { kind: 'guard_tower', x: 34, z: 30, active: true },
    { kind: 'guard_tower', x: -34, z: -54, active: true }, { kind: 'guard_tower', x: 34, z: -54 },
    { kind: 'dish', x: -40, z: -22, rot: 0.6 }, { kind: 'dish', x: -46, z: -6, s: 0.7, rot: 0.9 },
  ],
  cinder_yard: [
    { kind: 'cooling_tower', x: -84, z: -64, s: 1.2, active: true },
    { kind: 'chimney', x: 52, z: -70, active: true }, { kind: 'chimney', x: 60, z: -62, s: 0.8, active: true }, { kind: 'chimney', x: -48, z: 22, s: 0.7 },
    { kind: 'refinery', x: 56, z: -18 }, { kind: 'refinery', x: -54, z: -10, s: 0.8 },
    { kind: 'pipe_bridge', x: 0, z: -66 },
  ],
}

/** A box of a landmark, centre and size, with the material it wears. */
export interface LandmarkBox { x: number; y: number; z: number; w: number; h: number; d: number; mat: 'wallConc' | 'dark' | 'wire' }

/** The Blacksite's outer perimeter: a capped, wired wall with pilasters every 6 m, set
 *  `pad` metres beyond the playable bounds. Pure, so a test can prove no piece of it
 *  reaches into the site (a pilaster once spanned the whole compound). */
export function perimeterWall(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, pad = 15): LandmarkBox[] {
  const x0 = bounds.minX - pad, x1 = bounds.maxX + pad, z0 = bounds.minZ - pad, z1 = bounds.maxZ + pad;
  const runs: [number, number, number, number][] = [[(x0 + x1) / 2, z0, x1 - x0, 0.8], [(x0 + x1) / 2, z1, x1 - x0, 0.8], [x0, (z0 + z1) / 2, 0.8, z1 - z0], [x1, (z0 + z1) / 2, 0.8, z1 - z0]];
  const out: LandmarkBox[] = [];
  for (const [x, z, w, d] of runs) {
    const alongX = w > d, len = Math.max(w, d);
    out.push({ x, y: 2.75, z, w, h: 5.5, d, mat: 'wallConc' });
    out.push({ x, y: 5.75, z, w: w + 0.2, h: 0.5, d: d + 0.3, mat: 'dark' });
    out.push({ x, y: 6.4, z, w, h: 0.7, d: d * 0.6, mat: 'wire' });
    for (let t = -len / 2 + 3; t < len / 2; t += 6) {
      out.push(alongX
        ? { x: x + t, y: 2.9, z, w: 0.5, h: 5.8, d: d + 0.35, mat: 'dark' }
        : { x, y: 2.9, z: z + t, w: w + 0.35, h: 5.8, d: 0.5, mat: 'dark' })
    }
  }
  return out;
}

/** Terrain profile for the ring of land around the site. */
export interface Terrain {
  /** 'mesa' gives flat-topped buttes; 'ridge' jagged peaks; 'flats' low rolling hills. */
  shape: 'mesa' | 'ridge' | 'flats'
  /** Near ring then far ring, as [radius, base height, relief]. */
  rings: [number, number, number][]
  /** Rock colour by hour (the far ring fades toward the haze). */
  rock: Record<Phase, string>
  /** How much of the haze lies over the near and far ring (aerial perspective). */
  veil: [number, number]
}

export const TERRAIN: Record<LevelId, Terrain> = {
  dustline_depot: { shape: 'mesa', rings: [[120, 4, 16], [190, 10, 30]], rock: { day: '#9a5636', dusk: '#6e3a24', night: '#181a24' }, veil: [0.14, 0.42] },
  // Kept low: a ridge that rises much above ~10° fills the view through the gate as a wall.
  blacksite: { shape: 'ridge', rings: [[135, 3, 13], [205, 8, 26]], rock: { day: '#4a545c', dusk: '#2e2e38', night: '#080d14' }, veil: [0.4, 0.62] },
  cinder_yard: { shape: 'flats', rings: [[120, 3, 9], [190, 6, 16]], rock: { day: '#6a5444', dusk: '#4e3022', night: '#160f0c' }, veil: [0.3, 0.55] },
}

/** What drifts in the air, by hour. */
export interface Particles { kind: 'dust' | 'rain' | 'ash'; count: number; color: string }

export function airborne(level: LevelId, phase: Phase): Particles[] {
  if (level === 'dustline_depot') return [{ kind: 'dust', count: phase === 'night' ? 160 : 320, color: phase === 'night' ? '#8a8fa0' : '#e2cba4' }]
  // By day the Blacksite's air is the thick cold haze in the grade, not particles: big
  // soft points are fill-rate poison on a phone and render as hard squares where the
  // driver clamps point size.
  if (level === 'blacksite') return phase === 'night' ? [{ kind: 'rain', count: 900, color: '#9fb4c8' }] : []
  return [{ kind: 'ash', count: 380, color: phase === 'night' ? '#ff8a3a' : '#5a514a' }]
}

/** Ground wear scattered over the floor (flat paint, never cover). */
export interface Wear { kind: 'oil' | 'tracks' | 'sand' | 'puddle' | 'soot' | 'crack'; count: number }

export function groundWear(level: LevelId, phase: Phase): Wear[] {
  if (level === 'dustline_depot') return [{ kind: 'sand', count: 26 }, { kind: 'tracks', count: 10 }, { kind: 'oil', count: 14 }]
  if (level === 'blacksite') return [{ kind: phase === 'night' ? 'puddle' : 'crack', count: 18 }, { kind: 'oil', count: 8 }, { kind: 'crack', count: 10 }]
  return [{ kind: 'soot', count: 24 }, { kind: 'oil', count: 18 }, { kind: 'tracks', count: 6 }]
}
