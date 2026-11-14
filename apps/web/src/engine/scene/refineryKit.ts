import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * @module scene/refineryKit
 * @description Industrial plant built to the level's own dimensions.
 *
 * The Cinder Yard's tanks, fractionation columns and pipe racks are colliders in
 * `fps/cinderYard.ts`, and the collision data is the truth: a tank is a 7 m square
 * box, a column 3 m. What stands on that footprint has, until now, been one scaled
 * cylinder. These builders make the real thing at the real size: shell courses with
 * weld seams, a wind girder with a handrail, a conical roof with vents and a manway,
 * nozzles with flanges and a hand wheel, and an access stair tower; a column with
 * its skirt, platforms, ladder cage, head, vent and downcomers.
 *
 * Everything is returned as geometry grouped by the site material it should wear
 * (`tank` paint, `steel`, `pipe`, `concrete`, `hazard`, `rust`), so the level art
 * merges all tanks into one mesh per material: a tank farm is six draws, not sixty.
 *
 * GAMEPLAY RULE. Nothing here may protrude from the collider's footprint below head
 * height, or a player would walk through it. The cylinder is inscribed in its square
 * box, so the box's four corner zones (up to 0.41 r beyond the shell on the
 * diagonals) are where ground-level attachments live: the stair tower, the nozzles,
 * the ladder. Platforms and girders overhang only above 2.2 m. `footprintTest`
 * checks this for a built module.
 */

export type KitMaterial = 'tank' | 'steel' | 'pipe' | 'concrete' | 'hazard' | 'rust' | 'dark';
export type KitGeometry = Partial<Record<KitMaterial, THREE.BufferGeometry[]>>;

/** Height under which nothing may leave the collider's footprint. */
export const HEAD_CLEAR = 2.2;

const UNIT = new THREE.BoxGeometry(1, 1, 1);

function add(out: KitGeometry, mat: KitMaterial, g: THREE.BufferGeometry) {
  (out[mat] ??= []).push(g);
}
/** A box of the given size, placed and (optionally) turned about Y. */
function box(out: KitGeometry, mat: KitMaterial, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
  const g = UNIT.clone();
  g.scale(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  add(out, mat, g);
}
/** A vertical cylinder (or one turned about an axis). */
function cyl(out: KitGeometry, mat: KitMaterial, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 16, rx = 0, rz = 0, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  if (rx || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
  g.translate(x, y, z);
  add(out, mat, g);
}
/** A horizontal ring (a weld seam, a girder band, a cage hoop). */
function ring(out: KitGeometry, mat: KitMaterial, r: number, tube: number, x: number, y: number, z: number, seg = 32, arc = Math.PI * 2) {
  const g = new THREE.TorusGeometry(r, tube, 5, seg, arc);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  add(out, mat, g);
}
/** A pipe from a to b with a flange at each end. */
function pipe(out: KitGeometry, mat: KitMaterial, a: THREE.Vector3, b: THREE.Vector3, r: number, flanges = true) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 12, 1);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  add(out, mat, g);
  if (flanges) {
    for (const t of [0.06, len - 0.06]) {
      const f = new THREE.CylinderGeometry(r * 1.45, r * 1.45, 0.05, 12, 1);
      f.applyQuaternion(q);
      const p = a.clone().addScaledVector(dir, t);
      f.translate(p.x, p.y, p.z);
      add(out, 'steel', f);
    }
  }
}
/** A hand wheel on a stem, facing `dir`. */
function handwheel(out: KitGeometry, at: THREE.Vector3, dir: THREE.Vector3, r = 0.22) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  const wheel = new THREE.TorusGeometry(r, 0.025, 6, 20);
  wheel.applyQuaternion(q); wheel.translate(at.x, at.y, at.z); add(out, 'rust', wheel);
  for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    const spoke = new THREE.BoxGeometry(r * 2, 0.03, 0.03);
    spoke.rotateZ(a); spoke.applyQuaternion(q); spoke.translate(at.x, at.y, at.z); add(out, 'rust', spoke);
  }
  const stem = new THREE.CylinderGeometry(0.035, 0.035, 0.28, 8);
  stem.rotateX(Math.PI / 2); stem.applyQuaternion(q);
  const s = at.clone().addScaledVector(dir.clone().normalize(), -0.14);
  stem.translate(s.x, s.y, s.z); add(out, 'steel', stem);
}
/** Handrail along an arc or a straight run: posts every ~1.3 m, two rails, a toe board. */
function railArc(out: KitGeometry, cx: number, cz: number, r: number, y: number, a0: number, a1: number) {
  const n = Math.max(2, Math.round((Math.abs(a1 - a0) * r) / 1.3));
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    box(out, 'steel', 0.05, 1.05, 0.05, cx + Math.cos(a) * r, y + 0.52, cz + Math.sin(a) * r);
  }
  const arc = Math.abs(a1 - a0);
  ring(out, 'steel', r, 0.02, cx, y + 1.02, cz, 28, arc);
  ring(out, 'steel', r, 0.018, cx, y + 0.55, cz, 28, arc);
  ring(out, 'hazard', r, 0.04, cx, y + 0.07, cz, 28, arc);
}
export interface TankSpec {
  x: number; z: number;
  /** Footprint side (the collider box is square); the shell's diameter. */
  size: number;
  height: number;
  /** Which corner of the box carries the stair tower: 0..3 counting from +x+z. */
  stairCorner?: number;
}

/** A vertical storage tank with its appurtenances, in world coordinates. */
export function buildTank(t: TankSpec): KitGeometry {
  const out: KitGeometry = {};
  const r = t.size / 2, h = t.height, { x, z } = t;
  // Plinth and shell.
  cyl(out, 'concrete', r + 0.02, r + 0.04, 0.25, x, 0.125, z, 40);
  cyl(out, 'tank', r, r, h - 0.2, x, 0.2 + (h - 0.2) / 2, z, 48, 0, 0, true);
  // Courses: a weld seam every ~1.9 m, and vertical plate seams.
  const courses = Math.max(2, Math.round(h / 1.9));
  for (let i = 1; i < courses; i++) ring(out, 'steel', r + 0.012, 0.018, x, 0.2 + ((h - 0.2) * i) / courses, z, 48);
  const plates = Math.round((Math.PI * 2 * r) / 2.4);
  for (let i = 0; i < plates; i++) {
    const a = (i / plates) * Math.PI * 2 + 0.3;
    box(out, 'steel', 0.03, h - 0.3, 0.03, x + Math.cos(a) * (r + 0.005), 0.2 + (h - 0.3) / 2, z + Math.sin(a) * (r + 0.005), -a);
  }
  // Wind girder near the top: a walkway ring with a handrail (above head height).
  const gy = h - 1.3;
  const girder = new THREE.RingGeometry(r - 0.05, r + 0.75, 48);
  girder.rotateX(-Math.PI / 2); girder.translate(x, gy, z); add(out, 'steel', girder);
  const girderUnder = new THREE.RingGeometry(r - 0.05, r + 0.75, 48);
  girderUnder.rotateX(Math.PI / 2); girderUnder.translate(x, gy - 0.02, z); add(out, 'dark', girderUnder);
  ring(out, 'steel', r + 0.72, 0.04, x, gy - 0.04, z, 48);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; box(out, 'steel', 0.08, 0.5, 0.6, x + Math.cos(a) * (r + 0.35), gy - 0.28, z + Math.sin(a) * (r + 0.35), -a); }
  railArc(out, x, z, r + 0.7, gy, 0, Math.PI * 2);
  // Roof: a shallow cone, a centre vent, a manway, two breather vents.
  const roof = new THREE.ConeGeometry(r + 0.08, r * 0.14 + 0.25, 48, 1, false);
  roof.translate(x, h - 0.2 + (r * 0.14 + 0.25) / 2, z); add(out, 'tank', roof);
  const top = h + r * 0.14 + 0.05;
  cyl(out, 'steel', 0.22, 0.22, 0.9, x, top + 0.3, z, 12);
  cyl(out, 'steel', 0.36, 0.3, 0.16, x, top + 0.8, z, 12);
  cyl(out, 'steel', 0.45, 0.45, 0.25, x + r * 0.45, h + 0.05, z + r * 0.2, 16);
  cyl(out, 'steel', 0.5, 0.5, 0.05, x + r * 0.45, h + 0.19, z + r * 0.2, 16);
  for (const [dx, dz] of [[-0.5, 0.4], [0.2, -0.55]]) {
    cyl(out, 'pipe', 0.08, 0.08, 0.7, x + dx * r, h + 0.2, z + dz * r, 8);
    cyl(out, 'steel', 0.16, 0.16, 0.1, x + dx * r, h + 0.58, z + dz * r, 10);
  }
  // Nozzles at the base in the two free corner zones: a short run out of the shell with
  // flanges, a hand wheel, then down into the ground. Kept inside the box's corner.
  const corners = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  const stairCorner = t.stairCorner ?? 0;
  const nozzleCorners = [corners[(stairCorner + 1) % 4], corners[(stairCorner + 2) % 4]];
  nozzleCorners.forEach((a, i) => {
    const out1 = new THREE.Vector3(x + Math.cos(a) * (r - 0.1), 0.65 + i * 0.35, z + Math.sin(a) * (r - 0.1));
    const out2 = new THREE.Vector3(x + Math.cos(a) * (r + 0.55), 0.65 + i * 0.35, z + Math.sin(a) * (r + 0.55));
    pipe(out, 'pipe', out1, out2, 0.14 - i * 0.03);
    handwheel(out, out2.clone().add(new THREE.Vector3(0, 0.34, 0)), new THREE.Vector3(0, 1, 0), 0.2);
    pipe(out, 'pipe', out2, new THREE.Vector3(out2.x, -0.2, out2.z), 0.14 - i * 0.03, false);
  });
  // Access stair tower in the stair corner: two flights zig-zagging up a steel frame
  // between the shell and the box corner, a landing at the girder.
  {
    // The tower is a square of side `s` whose outer corner just fits the box corner;
    // its inner corner clips a little into the shell, which the shell hides.
    const a = corners[stairCorner];
    const s = Math.min(1.1, 0.31 * r), hs = s / 2;
    const c = (r - hs) * Math.SQRT2 - 0.03;
    const cx = x + Math.cos(a) * c, cz = z + Math.sin(a) * c;
    const flight = s - 0.2;
    for (const [dx, dz] of [[-hs, -hs], [hs, -hs], [-hs, hs], [hs, hs]]) box(out, 'steel', 0.1, gy + 0.4, 0.1, cx + dx, (gy + 0.4) / 2, cz + dz);
    for (let y = 2.2; y < gy; y += 2.2) for (const sd of [-1, 1]) { box(out, 'steel', s, 0.08, 0.08, cx, y, cz + sd * hs); box(out, 'steel', 0.08, 0.08, s, cx + sd * hs, y, cz); }
    // Flights alternate direction every 2.2 m of rise.
    const flights = Math.ceil(gy / 2.2);
    for (let f = 0; f < flights; f++) {
      const y0 = f * 2.2, y1 = Math.min(gy, y0 + 2.2);
      const dir = f % 2 === 0 ? 1 : -1;
      const steps = 8;
      for (let k = 0; k < steps; k++) {
        const ty = y0 + ((y1 - y0) * (k + 0.5)) / steps;
        const tx = cx + dir * (-flight / 2 + (flight * (k + 0.5)) / steps);
        box(out, 'hazard', 0.14, 0.03, s - 0.3, tx, ty, cz);
      }
      const ang = Math.atan2(y1 - y0, flight), len = Math.hypot(flight, y1 - y0);
      for (const sd of [-1, 1]) box(out, 'steel', len, 0.14, 0.05, cx, (y0 + y1) / 2, cz + sd * (hs - 0.08), 0, 0, dir * ang);
      box(out, 'dark', s, 0.05, s - 0.1, cx, y1, cz);
    }
    for (let y = HEAD_CLEAR; y < gy; y += 2.2) for (const sd of [-1, 1]) box(out, 'steel', 0.04, 0.04, s, cx + sd * (hs + 0.02), y + 1.0, cz);
    box(out, 'steel', s, 0.06, 0.9, cx, gy, cz);
  }
  // Ladder on the shell up to the roof from the girder (inside the roof's footprint).
  const la = corners[(stairCorner + 3) % 4];
  for (let y = gy + 0.3; y < top - 0.2; y += 0.3) box(out, 'steel', 0.4, 0.03, 0.03, x + Math.cos(la) * (r - 0.1), y, z + Math.sin(la) * (r - 0.1), -la);
  return out;
}

export interface ColumnSpec { x: number; z: number; size: number; height: number }

/** A fractionation column: skirt, vessel, platforms, ladder cage, head, vent, downcomers. */
export function buildColumn(c: ColumnSpec): KitGeometry {
  const out: KitGeometry = {};
  const r = c.size / 2 - 0.1, h = c.height, { x, z } = c;
  // Skirt, with a flared base ring and an access opening (a dark recess).
  cyl(out, 'concrete', r + 0.08, r + 0.1, 0.3, x, 0.15, z, 32);
  cyl(out, 'steel', r + 0.02, r + 0.08, 2.4, x, 1.5, z, 32);
  ring(out, 'steel', r + 0.12, 0.05, x, 2.7, z, 32);
  box(out, 'dark', 0.9, 1.6, 0.1, x + (r + 0.25) * Math.SQRT1_2, 1.1, z + (r + 0.25) * Math.SQRT1_2, -Math.PI / 4);
  // Vessel with heads.
  cyl(out, 'tank', r, r, h - 3.4, x, 2.7 + (h - 3.4) / 2, z, 40, 0, 0, true);
  const head = new THREE.SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  head.translate(x, h - 0.7, z); add(out, 'tank', head);
  // Insulation bands.
  for (let y = 4; y < h - 1.5; y += 2.6) ring(out, 'rust', r + 0.02, 0.045, x, y, z, 40);
  // Platforms at a third, two thirds and the top: grating ring, support brackets, handrail.
  for (const f of [0.3, 0.6, 0.9]) {
    const y = h * f;
    const grate = new THREE.RingGeometry(r - 0.05, r + 1.0, 32);
    grate.rotateX(-Math.PI / 2); grate.translate(x, y, z); add(out, 'steel', grate);
    const under = new THREE.RingGeometry(r - 0.05, r + 1.0, 32);
    under.rotateX(Math.PI / 2); under.translate(x, y - 0.02, z); add(out, 'dark', under);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; box(out, 'steel', 0.08, 0.35, 0.95, x + Math.cos(a) * (r + 0.5), y - 0.2, z + Math.sin(a) * (r + 0.5), -a); }
    ring(out, 'steel', r + 0.98, 0.04, x, y - 0.04, z, 32);
    railArc(out, x, z, r + 0.95, y, 0.35, Math.PI * 2 - 0.35);
  }
  // Ladder with cage hoops, on a diagonal (inside the box corner below head height).
  const la = Math.PI / 4;
  const lx = x + Math.cos(la) * (r + 0.35), lz = z + Math.sin(la) * (r + 0.35);
  for (const s of [-0.22, 0.22]) box(out, 'steel', 0.05, h * 0.9 - 0.5, 0.05, lx + Math.cos(la + Math.PI / 2) * s, 0.5 + (h * 0.9 - 0.5) / 2, lz + Math.sin(la + Math.PI / 2) * s);
  for (let y = 0.6; y < h * 0.9; y += 0.3) box(out, 'steel', 0.44, 0.03, 0.03, lx, y, lz, -la - Math.PI / 2);
  for (let y = HEAD_CLEAR + 0.3; y < h * 0.9 - 0.3; y += 0.7) ring(out, 'steel', 0.42, 0.02, lx + Math.cos(la) * 0.3, y, lz + Math.sin(la) * 0.3, 16, Math.PI * 1.3);
  // Vent stack on the head, with a rain cap.
  cyl(out, 'pipe', 0.12, 0.12, 3.2, x + 0.3, h + 0.8, z, 10);
  cyl(out, 'steel', 0.3, 0.16, 0.25, x + 0.3, h + 2.45, z, 12);
  // Downcomers: two pipes off the head running down the shell with elbows at the platforms.
  for (const [a, pr] of [[Math.PI * 1.15, 0.16], [Math.PI * 1.6, 0.11]] as const) {
    const px = x + Math.cos(a) * (r + 0.28), pz = z + Math.sin(a) * (r + 0.28);
    pipe(out, 'pipe', new THREE.Vector3(x + Math.cos(a) * (r * 0.5), h - 0.9, z + Math.sin(a) * (r * 0.5)), new THREE.Vector3(px, h - 0.9, pz), pr, false);
    pipe(out, 'pipe', new THREE.Vector3(px, h - 0.9, pz), new THREE.Vector3(px, 2.8, pz), pr, true);
    pipe(out, 'pipe', new THREE.Vector3(px, 2.8, pz), new THREE.Vector3(x + Math.cos(a) * (r + 0.05), 2.8, z + Math.sin(a) * (r + 0.05)), pr, false);
  }
  // Manways with bolted covers at two heights.
  for (const [a, y] of [[Math.PI * 0.2, h * 0.45], [Math.PI * 0.85, h * 0.75]] as const) {
    const g = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 16);
    g.rotateZ(Math.PI / 2); g.rotateY(-a); g.translate(x + Math.cos(a) * (r + 0.1), y, z + Math.sin(a) * (r + 0.1)); add(out, 'steel', g);
    const cover = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16);
    cover.rotateZ(Math.PI / 2); cover.rotateY(-a); cover.translate(x + Math.cos(a) * (r + 0.26), y, z + Math.sin(a) * (r + 0.26)); add(out, 'rust', cover);
  }
  return out;
}

export interface RackSpec { x: number; z: number; w: number; d: number; h: number }

/** The detail a low pipe rack carries beyond its three lines: flanges, hangers, a valve, an end elbow down. */
export function buildRackDetail(k: RackSpec): KitGeometry {
  const out: KitGeometry = {};
  const alongZ = k.d > k.w, len = alongZ ? k.d : k.w;
  const at = (t: number, off: number, y: number) => (alongZ ? new THREE.Vector3(k.x + off, y, k.z + t) : new THREE.Vector3(k.x + t, y, k.z + off));
  const lines: [number, number, number][] = [[k.h, -0.25, 0.14], [k.h, 0.05, 0.14], [k.h * 0.55, 0.3, 0.14]];
  // Flanged joints every 3 m, U-bolt hangers at each post.
  for (const [y, off, pr] of lines) {
    for (let t = -len / 2 + 1.5; t < len / 2 - 0.5; t += 3) {
      for (const dt of [-0.03, 0.03]) { const p = at(t + dt, off, y); const f = new THREE.CylinderGeometry(pr * 1.45, pr * 1.45, 0.05, 12); if (alongZ) f.rotateX(Math.PI / 2); else f.rotateZ(Math.PI / 2); f.translate(p.x, p.y, p.z); add(out, 'steel', f); }
    }
    for (let t = -len / 2 + 0.3; t <= len / 2 - 0.29; t += Math.max(1.5, len / 4)) { const p = at(t, off, y); ring(out, 'dark', pr + 0.03, 0.02, p.x, p.y, p.z, 12); }
  }
  // One valve with a hand wheel on the middle line, and a gauge.
  const vp = at(len * 0.18, 0.05, k.h);
  const body = new THREE.CylinderGeometry(0.2, 0.2, 0.34, 12); if (alongZ) body.rotateX(Math.PI / 2); else body.rotateZ(Math.PI / 2); body.translate(vp.x, vp.y, vp.z); add(out, 'rust', body);
  handwheel(out, vp.clone().add(new THREE.Vector3(0, 0.42, 0)), new THREE.Vector3(0, 1, 0), 0.18);
  const gp = at(-len * 0.3, -0.25, k.h + 0.3);
  cyl(out, 'steel', 0.03, 0.03, 0.3, gp.x, gp.y - 0.15, gp.z, 6);
  cyl(out, 'steel', 0.12, 0.12, 0.05, gp.x, gp.y, gp.z, 12, Math.PI / 2);
  // At one end the top line elbows down into the ground, inside the rack's footprint.
  const e0 = at(len / 2 - 0.5, -0.25, k.h), e1 = at(len / 2 - 0.18, -0.25, k.h);
  pipe(out, 'pipe', e0, e1, 0.14, false);
  pipe(out, 'pipe', e1, new THREE.Vector3(e1.x, -0.2, e1.z), 0.14, true);
  const elbow = new THREE.SphereGeometry(0.15, 10, 8); elbow.translate(e1.x, e1.y, e1.z); add(out, 'pipe', elbow);
  return out;
}

export interface StackSpec { x: number; z: number; height: number }

/**
 * A flare stack: a lattice derrick of four legs with cross bracing carrying the riser,
 * a platform and windshield at the tip, a ladder up one face. The flame itself stays a
 * live component (LevelArt FlareStack) so the economy can put it out.
 */
export function buildFlareStack(f: StackSpec): KitGeometry {
  const out: KitGeometry = {};
  const { x, z, height: h } = f;
  const base = 1.2, top = 0.55;
  // Legs taper from base to top; bracing every 3 m, alternating diagonals.
  const legAt = (i: number, y: number) => {
    const k = y / h, half = base + (top - base) * k;
    const sx = i % 2 === 0 ? -1 : 1, sz = i < 2 ? -1 : 1;
    return new THREE.Vector3(x + sx * half, y, z + sz * half);
  };
  for (let i = 0; i < 4; i++) pipe(out, 'steel', legAt(i, 0), legAt(i, h), 0.07, false);
  const pairs: [number, number][] = [[0, 1], [1, 3], [3, 2], [2, 0]];
  for (let y = 0; y < h - 1; y += 3) {
    for (const [a, b] of pairs) {
      pipe(out, 'steel', legAt(a, y), legAt(b, y), 0.035, false);
      pipe(out, 'steel', legAt(a, y), legAt(b, Math.min(h, y + 3)), 0.03, false);
    }
  }
  // Riser up the middle with flanged joints; a knock-out drum at the base.
  for (let y = 0.6; y < h; y += 6) pipe(out, 'pipe', new THREE.Vector3(x, y, z), new THREE.Vector3(x, Math.min(h + 1.2, y + 6), z), 0.3, true);
  // The knock-out drum sits inside the derrick's base (the base is the collider).
  cyl(out, 'rust', 0.55, 0.55, 1.6, x + 0.5, 0.9, z + 0.5, 14, Math.PI / 2);
  pipe(out, 'pipe', new THREE.Vector3(x + 0.5, 0.9, z + 0.5), new THREE.Vector3(x, 0.9, z), 0.14, true);
  // Tip: a windshield (open drum), a platform ring with a rail.
  cyl(out, 'rust', 0.9, 0.75, 2.2, x, h + 1.4, z, 20, 0, 0, true);
  const plat = new THREE.RingGeometry(0.5, 1.5, 20); plat.rotateX(-Math.PI / 2); plat.translate(x, h - 0.4, z); add(out, 'steel', plat);
  railArc(out, x, z, 1.45, h - 0.4, 0, Math.PI * 2);
  // Ladder up the -z face.
  for (let y = 1; y < h - 0.5; y += 0.3) { const k = y / h, half = base + (top - base) * k; box(out, 'steel', 0.4, 0.03, 0.03, x, y, z - half - 0.2); }
  // Aircraft warning bands.
  for (const k of [0.33, 0.66]) ring(out, 'hazard', 0.33, 0.04, x, h * k, z, 16);
  return out;
}

export interface LoadingArmSpec {
  /** The riser's foot (inside a tank's corner zone), and the point over the tanker it reaches. */
  from: [number, number]; to: [number, number, number];
}

/** A tanker loading arm: a riser with a swivel, a counterweighted boom, a drop pipe onto the tanker. */
export function buildLoadingArm(a: LoadingArmSpec): KitGeometry {
  const out: KitGeometry = {};
  const [fx, fz] = a.from, [tx, ty, tz] = a.to;
  const riserTop = ty + 1.2;
  cyl(out, 'concrete', 0.5, 0.55, 0.3, fx, 0.15, fz, 12);
  pipe(out, 'pipe', new THREE.Vector3(fx, 0.3, fz), new THREE.Vector3(fx, riserTop, fz), 0.16, true);
  cyl(out, 'steel', 0.3, 0.3, 0.35, fx, riserTop, fz, 14); // swivel
  const boomEnd = new THREE.Vector3(tx, ty + 0.6, tz);
  pipe(out, 'pipe', new THREE.Vector3(fx, riserTop, fz), boomEnd, 0.14, true);
  // Counterweight arm behind the swivel.
  const dir = new THREE.Vector3(tx - fx, 0, tz - fz).normalize();
  const back = new THREE.Vector3(fx, riserTop + 0.6, fz).addScaledVector(dir, -1.4);
  pipe(out, 'steel', new THREE.Vector3(fx, riserTop + 0.1, fz), back, 0.06, false);
  box(out, 'rust', 0.5, 0.5, 0.5, back.x, back.y, back.z, Math.atan2(dir.x, dir.z));
  // Drop pipe with a hose end onto the hatch.
  pipe(out, 'pipe', boomEnd, new THREE.Vector3(tx, ty + 0.05, tz), 0.12, false);
  const el = new THREE.SphereGeometry(0.17, 10, 8); el.translate(boomEnd.x, boomEnd.y, boomEnd.z); add(out, 'pipe', el);
  cyl(out, 'dark', 0.2, 0.24, 0.12, tx, ty + 0.04, tz, 12);
  return out;
}

export interface WallSpec { x: number; z: number; w: number; d: number; h: number; /** Which face: +z faces +z. */ face: '+z' | '-z' | '+x' | '-x' }

/**
 * The services a site hangs on a wall above head height: a cable tray with conduit
 * drops and junction boxes, a floodlight on a bracket, a horn speaker. Nothing below
 * HEAD_CLEAR leaves the wall's own footprint.
 */
export function buildWallServices(w: WallSpec, seed = 1): KitGeometry {
  const out: KitGeometry = {};
  const along = w.face === '+z' || w.face === '-z' ? 'x' : 'z';
  const len = along === 'x' ? w.w : w.d;
  const n = w.face === '+z' ? [0, 1] : w.face === '-z' ? [0, -1] : w.face === '+x' ? [1, 0] : [-1, 0];
  const faceOff = (along === 'x' ? w.d : w.w) / 2;
  const at = (t: number, off: number, y: number) => new THREE.Vector3(w.x + (along === 'x' ? t : n[0] * (faceOff + off)), y, w.z + (along === 'z' ? t : n[1] * (faceOff + off)));
  const yaw = along === 'x' ? 0 : Math.PI / 2;
  const trayY = Math.min(w.h - 0.4, 2.75);
  if (trayY < HEAD_CLEAR + 0.2) return out;
  // Cable tray: a shallow channel with brackets every 2 m.
  { const p = at(0, 0.18, trayY); box(out, 'dark', along === 'x' ? len - 0.4 : 0.3, 0.08, along === 'x' ? 0.3 : len - 0.4, p.x, p.y, p.z); }
  for (const s of [-1, 1]) { const p = at(0, 0.18 + s * 0.14, trayY + 0.06); box(out, 'steel', along === 'x' ? len - 0.4 : 0.03, 0.12, along === 'x' ? 0.03 : len - 0.4, p.x, p.y, p.z); }
  for (let t = -len / 2 + 1; t < len / 2 - 0.5; t += 2) { const p = at(t, 0.16, trayY - 0.08); box(out, 'steel', along === 'x' ? 0.06 : 0.34, 0.06, along === 'x' ? 0.34 : 0.06, p.x, p.y, p.z); }
  // Conduit drops to junction boxes (they stop above head height), a horn, a floodlight.
  let r = seed * 7919;
  const rnd = () => { r = (r * 48271) % 2147483647; return r / 2147483647; };
  for (let t = -len / 2 + 2 + rnd() * 2; t < len / 2 - 1.5; t += 3.5 + rnd() * 3) {
    const by = HEAD_CLEAR + 0.15 + rnd() * 0.3;
    const p = at(t, 0.1, (trayY + by) / 2);
    cyl(out, 'steel', 0.03, 0.03, trayY - by, p.x, p.y, p.z, 6);
    const b = at(t, 0.12, by); box(out, 'dark', 0.26, 0.3, 0.14, b.x, b.y, b.z, yaw);
  }
  { const p = at(len * 0.3, 0.3, trayY + 0.55); const g = new THREE.ConeGeometry(0.22, 0.45, 12, 1, true); g.rotateX(-Math.PI / 2); if (n[0] < 0 || n[1] < 0) g.rotateY(Math.PI); if (along === 'z') g.rotateY(Math.PI / 2 * (n[0] > 0 ? 1 : -1)); g.translate(p.x, p.y, p.z); add(out, 'dark', g); }
  { const p = at(-len * 0.3, 0.25, trayY + 0.5); box(out, 'steel', 0.08, 0.5, 0.08, p.x, p.y - 0.1, p.z); const l = at(-len * 0.3, 0.45, trayY + 0.75); box(out, 'steel', 0.5, 0.3, 0.3, l.x, l.y, l.z, yaw); }
  return out;
}

/** Merge a list of kit geometries into one BufferGeometry per material. */
export function mergeKit(parts: KitGeometry[]): Partial<Record<KitMaterial, THREE.BufferGeometry>> {
  const by: KitGeometry = {};
  for (const p of parts) for (const [m, gs] of Object.entries(p) as [KitMaterial, THREE.BufferGeometry[]][]) (by[m] ??= []).push(...gs);
  const out: Partial<Record<KitMaterial, THREE.BufferGeometry>> = {};
  for (const [m, gs] of Object.entries(by) as [KitMaterial, THREE.BufferGeometry[]][]) {
    const flat = gs.map((g) => {
      const f = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(f.attributes)) if (k !== 'position' && k !== 'normal') f.deleteAttribute(k);
      return f;
    });
    const merged = mergeGeometries(flat, false);
    flat.forEach((g) => g.dispose());
    if (merged) { merged.computeBoundingSphere(); out[m] = merged; }
  }
  return out;
}

/** Triangle count of a kit geometry set (for budgets and tests). */
export function kitTriangles(k: KitGeometry): number {
  let n = 0;
  for (const gs of Object.values(k)) for (const g of gs ?? []) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  return n;
}

/**
 * The gameplay rule, checked: every vertex below HEAD_CLEAR lies inside the collider's
 * square footprint (plus a small tolerance). Returns the offending vertices' count.
 */
export function footprintViolations(k: KitGeometry, cx: number, cz: number, half: number, tolerance = 0.05): number {
  let bad = 0;
  const v = new THREE.Vector3();
  for (const gs of Object.values(k)) for (const g of gs ?? []) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (v.y >= HEAD_CLEAR || v.y < -0.3) continue;
      if (Math.abs(v.x - cx) > half + tolerance || Math.abs(v.z - cz) > half + tolerance) bad++;
    }
  }
  return bad;
}
