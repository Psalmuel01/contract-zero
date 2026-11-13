/**
 * Raised walkways. A level may declare decks (flat walkable tops at a height) and stairs
 * (ramps that rise to a deck). The player's feet follow `groundHeight`; collisions stay
 * two-dimensional, and the sim already takes the eye height into sight and bullet paths,
 * so what you can see and hit from up there is what the geometry really allows.
 * Guards navigate on the ground only: they never climb.
 */

export interface Deck { x: number; z: number; w: number; d: number; /** Height of the walking surface. */ h: number }
/** A ramp rising from the ground to `h` along `rise` (the direction you climb). */
export interface Stair { x: number; z: number; w: number; d: number; h: number; rise: '+x' | '-x' | '+z' | '-z' }
export interface Decked { decks?: Deck[]; stairs?: Stair[] }

const inside = (r: { x: number; z: number; w: number; d: number }, x: number, z: number) => Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2

/** How far up a stair you are at (x, z), 0..h, or null off the stair. */
export function stairHeight(s: Stair, x: number, z: number): number | null {
  if (!inside(s, x, z)) return null
  const along = s.rise === '+x' ? x - (s.x - s.w / 2) : s.rise === '-x' ? s.x + s.w / 2 - x : s.rise === '+z' ? z - (s.z - s.d / 2) : s.z + s.d / 2 - z
  const len = s.rise.endsWith('x') ? s.w : s.d
  return Math.max(0, Math.min(1, along / len)) * s.h
}

/** The most a single step can lift you. A stair rises a few centimetres a frame; a deck's
 *  edge or a stair's side rises metres, so this tells walking up apart from teleporting. */
export const STEP_UP = 0.6

/**
 * The height of the floor under (x, z): the highest deck or stair there that you can step
 * onto from `from` (your current floor), else the ground (0).
 *
 * Without `from` it is the highest surface at that point, which is wrong for a body: the
 * walkways have open ground under them, so walking beneath the catwalk or into the side of
 * a stair would put you on top. A surface counts only if it is at most STEP_UP above you.
 */
export function groundHeight(level: Decked | undefined, x: number, z: number, from = Infinity): number {
  if (!level) return 0
  const reach = from + STEP_UP
  let y = 0
  for (const d of level.decks ?? []) if (inside(d, x, z) && d.h > y && d.h <= reach) y = d.h
  for (const s of level.stairs ?? []) { const h = stairHeight(s, x, z); if (h !== null && h > y && h <= reach) y = h }
  return y
}

/** The stair's low end, where you step on: the centre of that edge. */
export function stairFoot(s: Stair): [number, number] {
  return s.rise === '+x' ? [s.x - s.w / 2, s.z] : s.rise === '-x' ? [s.x + s.w / 2, s.z] : s.rise === '+z' ? [s.x, s.z - s.d / 2] : [s.x, s.z + s.d / 2]
}

/**
 * Railings. Up on a deck or stair you cannot walk off its side: a step that would drop you
 * more than `maxDrop` (a little over what the smoothed floor lags behind you on a steep stair) is slid along the walkway instead (one axis at a time), or refused.
 * On the ground nothing changes. Dropping is only by walking down the stair.
 */
export function railedMove(level: Decked | undefined, floor: number, ox: number, oz: number, nx: number, nz: number, maxDrop = 1.3): [number, number] {
  if (!level || floor < 0.5) return [nx, nz]
  const ok = (x: number, z: number) => groundHeight(level, x, z, floor) >= floor - maxDrop
  if (ok(nx, nz)) return [nx, nz]
  if (ok(nx, oz)) return [nx, oz]
  if (ok(ox, nz)) return [ox, nz]
  return [ox, oz]
}
