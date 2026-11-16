/**
 * Which locomotion clip a guard plays, and how fast, from how its body is actually
 * moving relative to where it faces. Guards always face the player, so a guard
 * circling to a new angle moves sideways: that is a strafe, not a run. A guard
 * barely drifting stands. The rate keeps footfalls in step with ground speed, so the
 * feet don't skate. Presentation only: the AI, positions and hitboxes are unchanged.
 *
 * Reference speeds are the clips' own (Mixamo rifle set at operator scale): a walk
 * covers ~1.4 m/s at rate 1, a run ~3.4 m/s, a strafe ~2.2 m/s.
 */
export type Gait = { clip: 'idle' | 'walk' | 'run' | 'strafeL' | 'strafeR'; rate: number };

const STAND = 0.3;      // m/s: below this the guard is holding position
const RUN_FROM = 1.9;   // m/s: forward speed where a walk becomes a run
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function enemyGait(vx: number, vz: number, facing: number): Gait {
  const speed = Math.hypot(vx, vz);
  if (speed < STAND) return { clip: 'idle', rate: 1 };
  // The rig faces +Z rotated by `facing` about Y.
  const fx = Math.sin(facing), fz = Math.cos(facing);
  const forward = vx * fx + vz * fz;           // + toward where it faces
  const right = vx * -fz + vz * fx;            // + to its right (screen-right when facing away)
  if (Math.abs(right) > Math.abs(forward) * 1.2) {
    return { clip: right > 0 ? 'strafeR' : 'strafeL', rate: clamp(speed / 2.2, 0.6, 1.4) };
  }
  // Backing off reads as a walk (the run clip leans forward), played at pace.
  if (forward < 0 || speed < RUN_FROM) return { clip: 'walk', rate: clamp(speed / 1.4, 0.6, 1.6) };
  return { clip: 'run', rate: clamp(speed / 3.4, 0.7, 1.3) };
}
