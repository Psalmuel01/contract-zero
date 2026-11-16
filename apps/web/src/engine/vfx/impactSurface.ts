import type { ImpactSurface } from './ImpactFX';
import type { Kind } from '../fps/levels';

/**
 * What a round is actually going through when it lands, so the impact reads right: a
 * shower of sparks off a steel tank, powder off a concrete barrier, splinters off a
 * crate, earth off the ground. The sim only knows boxes; the level knows what each box
 * IS (its `kind`). Purely visual: damage and penetration are untouched.
 */
const KIND_SURFACE: Record<Kind, ImpactSurface> = {
  // steel
  container: 'metal', truck: 'metal', tank: 'metal', tower_leg: 'metal', warehouse: 'metal',
  rack: 'metal', server: 'metal', column: 'metal', pipe_rack: 'metal', pump: 'metal',
  cabinet: 'metal', locker: 'metal', drum: 'metal', door_frame: 'metal', fence: 'metal',
  console: 'metal', desk: 'metal', bed: 'metal', case: 'metal',
  // timber
  crate: 'wood',
  // masonry
  barrier: 'concrete', booth: 'concrete', concrete: 'concrete', facade: 'concrete', interior: 'concrete',
};

export function surfaceForKind(kind: Kind | undefined): ImpactSurface | null {
  return kind ? KIND_SURFACE[kind] ?? null : null;
}

export interface SurfaceBox { x: number; z: number; w: number; d: number; h: number; kind?: Kind }
export interface SurfaceContext {
  cover: SurfaceBox[];
  walls: SurfaceBox[];
  /** The site's floor; earth unless the level says it's paved. */
  floor?: 'dirt' | 'concrete';
  /** Paved rectangles on an earth site (roads). */
  roads?: { x: number; z: number; w: number; d: number }[];
}

const inside = (at: [number, number, number], b: SurfaceBox, pad = 0.08) =>
  Math.abs(at[0] - b.x) <= b.w / 2 + pad && Math.abs(at[2] - b.z) <= b.d / 2 + pad && at[1] <= b.h + pad;

/** The surface at a point a round struck, given the outward normal there. */
export function impactSurface(at: [number, number, number], normal: [number, number, number], ctx: SurfaceContext): ImpactSurface {
  if (normal[1] > 0.9 && at[1] < 0.06) {
    if (ctx.floor === 'concrete') return 'concrete';
    if (ctx.roads?.some((r) => Math.abs(at[0] - r.x) <= r.w / 2 && Math.abs(at[2] - r.z) <= r.d / 2)) return 'concrete';
    return 'dirt';
  }
  for (const c of ctx.cover) if (inside(at, c)) return surfaceForKind(c.kind) ?? 'wood';
  for (const w of ctx.walls) if (inside(at, w)) return surfaceForKind(w.kind) ?? 'concrete';
  return 'concrete';
}
