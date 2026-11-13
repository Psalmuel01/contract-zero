import { MathUtils } from 'three'

/** Presentation only: these curves never change the weapon's reload/fire timing. */
export function reloadPose(progress: number, active: boolean, reduceMotion: boolean) {
  if (!active || reduceMotion) return { dip: 0, roll: 0, magazineDrop: 0, handReach: 0 }
  const p = MathUtils.clamp(progress, 0, 1)
  const hold = MathUtils.smoothstep(p, 0, .16) * (1 - MathUtils.smoothstep(p, .8, 1))
  const mag = MathUtils.smoothstep(p, .18, .32) * (1 - MathUtils.smoothstep(p, .58, .76))
  return { dip: hold * .055, roll: hold * -.22, magazineDrop: mag * .19, handReach: mag * .10 }
}

/** Keep the whole weapon ahead of the eye even during recoil and near-wall poses. */
export function safeWeaponDepth(requested: number, length: number, scale = 1): number {
  return Math.min(requested, -(length * scale / 2 + .09))
}
