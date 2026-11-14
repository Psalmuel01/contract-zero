import { MathUtils } from 'three'

export interface ReloadPose {
  /** The weapon comes in toward the centre, dips and rolls so the magazine well faces you. */
  dip: number; roll: number; yaw: number; shift: number
  /** How far the magazine has dropped out of the well (metres). */
  magazineDrop: number
  /** How far the support hand has left the handguard for the magazine (metres). */
  handReach: number
  /** The seat: a short upward bump as the fresh magazine is slapped home. */
  bump: number
}

const REST: ReloadPose = { dip: 0, roll: 0, yaw: 0, shift: 0, magazineDrop: 0, handReach: 0, bump: 0 }

/**
 * Presentation only: these curves never change the weapon's reload/fire timing. They
 * are shaped to the reload's fraction, so a fast pistol and a slow rifle both land their
 * magazine when their own reload says so.
 *
 *  0.00-0.16  the weapon tilts in and dips; the support hand leaves the handguard
 *  0.18-0.32  the empty magazine falls out of the well (hand goes with it)
 *  0.32-0.58  the hand is away bringing the fresh one (the drop holds at its lowest)
 *  0.58-0.76  the fresh magazine comes up into the well
 *  0.76-0.84  the seat: a bump up as it is slapped home
 *  0.80-1.00  the weapon comes back level, the hand returns
 */
export function reloadPose(progress: number, active: boolean, reduceMotion: boolean): ReloadPose {
  if (!active || reduceMotion) return REST
  const p = MathUtils.clamp(progress, 0, 1)
  const hold = MathUtils.smoothstep(p, 0, .16) * (1 - MathUtils.smoothstep(p, .8, 1))
  const mag = MathUtils.smoothstep(p, .18, .32) * (1 - MathUtils.smoothstep(p, .58, .76))
  const reach = MathUtils.smoothstep(p, .08, .22) * (1 - MathUtils.smoothstep(p, .76, .9))
  const seat = MathUtils.smoothstep(p, .76, .8) * (1 - MathUtils.smoothstep(p, .8, .88))
  return { dip: hold * -.02, roll: hold * -.24, yaw: hold * .08, shift: hold * -.09, magazineDrop: mag * .2, handReach: reach * .12, bump: seat * .02 }
}

/**
 * How close the weapon may come to the eye, as the depth of its centre.
 *
 * The STOCK is allowed to run back past the eye: that is how a shouldered weapon is
 * framed (it leaves through the bottom corner, off-screen and beside the camera, never
 * through it). Holding the whole weapon in front of the eye instead pushes it out into a
 * giant side-on slab. What must stay ahead is the grip and receiver, the part in view:
 * the point 15% of the length behind the centre keeps 10 cm of clearance.
 */
export function safeWeaponDepth(requested: number, length: number, scale = 1, aimed = 0): number {
  // Aimed, the weapon is on the centre line, so the whole of it stays ahead of the eye.
  const behind = length * scale * (.15 + .35 * aimed)
  return Math.min(requested, -(behind + .1))
}
