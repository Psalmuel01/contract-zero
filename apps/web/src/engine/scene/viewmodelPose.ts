import { MathUtils } from 'three'

/** Presentation only: these curves never change the weapon's reload/fire timing. */
export function reloadPose(progress: number, active: boolean, reduceMotion: boolean) {
  if (!active || reduceMotion) return { dip: 0, roll: 0, magazineDrop: 0, handReach: 0 }
  const p = MathUtils.clamp(progress, 0, 1)
  const hold = MathUtils.smoothstep(p, 0, .16) * (1 - MathUtils.smoothstep(p, .8, 1))
  const mag = MathUtils.smoothstep(p, .18, .32) * (1 - MathUtils.smoothstep(p, .58, .76))
  return { dip: hold * .055, roll: hold * -.22, magazineDrop: mag * .19, handReach: mag * .10 }
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
