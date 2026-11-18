/**
 * @module scene/viewmodelHands
 * @description The hands holding your weapon.
 *
 * Until now the first-person viewmodel had ONE 6cm cube of brown, labelled in the
 * scene as "simple graybox hands so the first person reads". It didn't: at the
 * framing the game actually uses it sits behind the receiver and is never visible,
 * so every weapon floated in front of the camera with nothing holding it.
 * A floating gun is the single loudest "this is a prototype" tell a shooter has —
 * the hands are what make the weapon YOURS rather than a prop on a stick.
 *
 * Built from primitives for the same reason the seasonal weapons are
 * (scene/proceduralGuns): a rig costs a function instead of a modelling and rigging
 * pipeline, and it can be parameterised per weapon — a pistol and an LMG are not
 * held the same way, and the grip has to move with the gun it is on.
 *
 * What makes them not look like stacked boxes, borrowing the gun module's rules:
 *
 *  • GLOVES, NOT SKIN. Tactical gloves fit the operator fantasy, and they dodge the
 *    uncanny problem that a bare hand is a face-level object everyone can spot as
 *    wrong. Fabric, a rubberised palm and a knuckle guard read as three materials.
 *  • SILHOUETTE FIRST. At viewmodel size you read the outline of a fist and the line
 *    of the forearm; nothing finer survives. Fingers are ridges on that outline
 *    rather than articulated digits.
 *  • FOREARMS. A pair of disembodied hands is worse than none — the arms running
 *    back out of frame are what connect the weapon to a body.
 *  • MERGED. Every part of a hand shares a geometry per material, so the whole rig
 *    is three draw calls rather than the twenty-odd it is modelled from. The
 *    viewmodel redraws every frame, in front of everything, on phones.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GunId } from '../combat/GunStats';

/**
 * Where the weapon sits relative to the eye, hip-ready and down the sights. The
 * scene lerps between these by the ADS factor.
 *
 * They live here rather than in ContractZeroScene so the grip bench (/dev/grip) can frame a
 * weapon exactly the way the game does. A bench that is a few centimetres off is
 * worse than no bench: you tune a grip until it reads there and it is wrong in the
 * op, which is precisely the failure these anchors are hand-tuned to avoid.
 */
export const VIEWMODEL_HIP = new THREE.Vector3(0.2, -0.2, -0.5);
// ADS is a gentle RAISE of the hip pose, not a shove into the camera. The rifle is
// ~0.88m long and centred on its origin (rear ~0.44m back), so pulling it to z=-0.32
// AND centring it (x=0) put the chunky receiver end-on ~1cm from the eye = a giant
// black blob. Instead keep it at hip depth (-0.5, whole gun in front), only slightly
// toward centre (x 0.2->0.1 so you still see its side, not its rear), and lift it
// (y -0.2->-0.1). The aim "zoom" comes from the FOV narrowing, not the gun position.
export const VIEWMODEL_ADS = new THREE.Vector3(0.1, -0.1, -0.5);

// Each model is now normalised to its own real length (see gunModels.ts), so
// `scale` is a small fudge for hand-fit, not a size proxy; z/y slide the weapon
// in the hands (a long DMR sits pushed out, a pistol held in close).
/** `ads`: where this weapon sits once aimed, when it has a real sight line (replaces
 *  VIEWMODEL_ADS and the hip offsets). Others keep the shared gentle raise. */
export const WEAPON_VIEW: Record<GunId, { scale: number; z: number; y: number; ads?: [number, number, number] }> = {
  sidearm: { scale: 1.0, z: 0.16, y: 0.03 },  // a compact pistol, raised so the grip and hand read
  smg: { scale: 1.0, z: 0.08, y: 0.025 },     // stubby, snappy; raised so both hands read
  // The service carbine: drawn back so the stock leaves through the corner and the
  // receiver and handguard carry the frame.
  // Aimed, it is shouldered: on the centre line with the top rail 2.7 cm under the eye
  // (the model is centred on its bounds, which puts the rail top 0.149 above centre),
  // so you look along the rail to the front sight and the stock passes under the eye.
  // Off to the side, as the shared pose has it, you looked at its flank instead.
  assault_rifle: { scale: 1.0, z: 0.07, y: -0.03, ads: [0, -0.176, -0.42] },
  marksman: { scale: 1.0, z: -0.05, y: 0.01 },// long — pushed out front
  legendary: { scale: 1.0, z: 0, y: 0 },      // the ZX-0 Prototype
  // Seasonal weapons: longer bodies are pushed further out so the muzzle clears frame.
  ashfall_carbine: { scale: 1.0, z: 0.04, y: -0.005 },
  warden_repeater: { scale: 1.0, z: -0.06, y: 0.01 },
  rift_lance:      { scale: 1.0, z: -0.07, y: 0.012 },
  seraph_lmg:      { scale: 1.0, z: -0.03, y: 0.005 },
  ember_halo:      { scale: 1.0, z: -0.02, y: 0.008 },
};


// ── Materials ─────────────────────────────────────────────────────────────────
// Shared instances: ten weapons' worth of hands is still one shader program each.

const GLOVE = new THREE.MeshStandardMaterial({ color: 0x2f3238, roughness: 0.88, metalness: 0.03 });
/** The rubberised palm and finger pads — darker and glossier than the fabric, which
 *  is what separates the gripping surface from the back of the hand. */
const PALM = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.55, metalness: 0.06 });
/** Sleeve, a shade off the glove so the cuff line reads. */
const SLEEVE = new THREE.MeshStandardMaterial({ color: 0x1e201b, roughness: 1, metalness: 0 });

/** Dispose the shared materials. Only for tests and hot paths that tear the scene
 *  down; the app holds these for its lifetime. */
export function disposeHandMaterials(): void {
  GLOVE.dispose();
  PALM.dispose();
  SLEEVE.dispose();
}

// ── Primitives ────────────────────────────────────────────────────────────────

/** A rounded box, returned as geometry so it can be merged rather than drawn on its own. */
function box(w: number, h: number, d: number, r = 0.005): THREE.BufferGeometry {
  const radius = Math.min(r, w / 2.2, h / 2.2, d / 2.2);
  const shape = new THREE.Shape();
  const x = w / 2 - radius, y = h / 2 - radius;
  shape.moveTo(-x, -h / 2);
  shape.lineTo(x, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -y);
  shape.lineTo(w / 2, y);
  shape.quadraticCurveTo(w / 2, h / 2, x, h / 2);
  shape.lineTo(-x, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, y);
  shape.lineTo(-w / 2, -y);
  shape.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d, bevelEnabled: true, bevelSize: radius * 0.5,
    bevelThickness: radius * 0.5, bevelSegments: 1, curveSegments: 2,
  });
  geo.translate(0, 0, -d / 2);
  geo.computeVertexNormals();
  return geo;
}

/** Position + rotate a geometry in place, so parts can be laid out and then merged. */
function at(
  geo: THREE.BufferGeometry,
  x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0,
): THREE.BufferGeometry {
  if (rx || ry || rz) {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    geo.applyMatrix4(m);
  }
  geo.translate(x, y, z);
  return geo;
}

/** A tapered limb (the forearm), hanging straight DOWN from its origin so the wrist
 *  is the pivot and a single X rotation swings it back toward the elbow. */
function limb(rTop: number, rBot: number, len: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, 12, 1);
  g.translate(0, -len / 2, 0);
  return g;
}

/**
 * A finger segment between two joints: a capsule from `a` to `b`, slightly squashed
 * so it reads as a gloved finger rather than a tube. Low segment counts: there are
 * fourteen of these per hand and they are a few pixels wide on screen.
 */
function segment(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, len, 2, 7);
  // CapsuleGeometry runs along +Y; aim it from a to b.
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  g.scale(1, 1, 1);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Capsules and spheres come indexed, extruded boxes do not, and mergeGeometries
  // refuses a mix. Everything is flattened first; a hand is a few thousand triangles.
  const flat = parts.map((g) => {
    const out = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
    return out;
  });
  return mergeGeometries(flat, false) ?? flat[0];
}

// ── One hand ──────────────────────────────────────────────────────────────────

export interface HandOptions {
  /** Mirror the whole hand across X. The two hands are the same model handed. */
  left?: boolean;
  /** Overall size. 1 ≈ an adult hand at 0.09m across. */
  scale?: number;
  /** How far the fingers curl around, 0..1. A support hand on a fat handguard opens
   *  out; a firing hand on a thin grip closes right up. */
  curl?: number;
  /** Radius of what the fingers wrap (a pistol grip ≈ 0.02, a handguard ≈ 0.03). */
  gripRadius?: number;
  /** Length of the forearm running back out of frame. 0 for none. */
  forearm?: number;
  /** How far the forearm swings BACK from straight down, in radians. */
  forearmPitch?: number;
  /** Splay of the forearm away from the weapon's centre line. */
  forearmYaw?: number;
  /** Index finger straight along the side (off the trigger) instead of curled. */
  indexStraight?: boolean;
  /** Thumb laid forward along the grip's far side (a support hand's thumb along the
   *  handguard) rather than hooked over the back. */
  thumbForward?: boolean;
  /** Where the forearm runs from the wrist, in the hand's own frame. Overrides the
   *  pitch/yaw pair; used when the hand is rolled under a handguard. */
  forearmDir?: [number, number, number];
}

/**
 * A gloved hand, built around a grip that runs vertically through its origin.
 *
 * Local frame: +Y is up the grip (toward the wrist), +Z is toward the muzzle, +X is
 * outboard (the back of the hand). The origin sits where the grip passes through the
 * palm, so a caller positions a hand by saying where on the weapon it is holding.
 *
 * Fingers are articulated: three capsule segments each, walked around an arc of the
 * grip's radius and pulled tighter by `curl`, so a fist actually closes around the
 * grip and an open hand actually cups a handguard. At viewmodel size that outline,
 * with the knuckle plate and the cuff, is the whole read of "tactical glove".
 */
export function buildHand(opts: HandOptions = {}): THREE.Group {
  const s = opts.scale ?? 1;
  const curl = THREE.MathUtils.clamp(opts.curl ?? 1, 0, 1);
  const R = (opts.gripRadius ?? 0.019) + 0.011; // joint path radius: grip plus the finger's own radius
  // Handedness is a mirrored LAYOUT, not a mirrored object (a -1 scale reverses the
  // winding and lights the glove from the inside). Every X offset and Y/Z rotation
  // is negated instead.
  const m = opts.left ? -1 : 1;
  const glove: THREE.BufferGeometry[] = [];
  const palm: THREE.BufferGeometry[] = [];
  const sleeve: THREE.BufferGeometry[] = [];

  // Palm: the slab outboard of the grip, slightly cupped toward it.
  glove.push(at(box(0.024, 0.088, 0.072, 0.012), m * 0.030, 0.006, -0.004, 0, 0, m * 0.06));
  // The rubberised palm facing the grip, where it actually bears.
  palm.push(at(box(0.012, 0.080, 0.062, 0.009), m * 0.018, 0.004, -0.002));
  // Knuckle plate: the hard shell across the back at the knuckle line.
  glove.push(at(box(0.014, 0.026, 0.066, 0.006), m * 0.040, 0.028, 0.004, 0.12, 0, m * -0.1));

  // Fingers. Each starts at the palm's front edge and walks an arc around the grip
  // axis; curl shortens the arc's radius and closes the final joints further.
  const FINGERS: { y: number; len: number; r: number }[] = [
    { y: 0.034, len: 1.0, r: 0.0098 },   // index
    { y: 0.010, len: 1.08, r: 0.0100 },  // middle
    { y: -0.014, len: 1.0, r: 0.0094 },  // ring
    { y: -0.037, len: 0.82, r: 0.0086 }, // little
  ];
  const SEG = [0.040, 0.027, 0.022];
  FINGERS.forEach((f, fi) => {
    const straight = opts.indexStraight && fi === 0;
    const radius = R * (straight ? 1.5 : 1 / (0.55 + 0.45 * curl));
    // Start angle, measured from +X toward +Z: front-outboard of the grip.
    let a = 0.62;
    let y = f.y;
    const pts: THREE.Vector3[] = [new THREE.Vector3(m * Math.cos(a) * radius, y, Math.sin(a) * radius)];
    for (let k = 0; k < 3; k++) {
      const len = SEG[k] * f.len;
      // A straight index lies along the grip's side; a curled finger wraps.
      const sweep = straight ? 0.08 : (len / radius) * (0.55 + 0.45 * curl) * (k === 0 ? 1 : 0.85 + 0.15 * curl);
      a += sweep;
      y -= 0.0035 * (1 + 0.6 * k) * (straight ? 0.3 : 1); // fingers slant down the grip
      pts.push(new THREE.Vector3(m * Math.cos(a) * radius, y, Math.sin(a) * radius + (straight ? len * 0.9 : 0) * (k + 1) * 0.5));
    }
    for (let k = 0; k < 3; k++) {
      const r = f.r * (1 - k * 0.08);
      glove.push(segment(pts[k], pts[k + 1], r));
      // A knuckle at each joint, and a pad on the inside of each segment.
      if (k > 0) { const j = new THREE.SphereGeometry(r * 1.08, 7, 6); j.translate(pts[k].x, pts[k].y, pts[k].z); glove.push(j); }
    }
    // Pad under the last two segments (the part that touches the grip).
    const pad = segment(pts[1], pts[3], f.r * 0.72);
    pad.translate(m * -0.002, 0, 0);
    palm.push(pad);
  });

  // Thumb: two segments. Hooked over the back of the grip (firing hand), or laid
  // forward along its far side (support hand along a handguard).
  {
    const base = new THREE.Vector3(m * 0.024, 0.044, -0.020);
    const mid = opts.thumbForward
      ? new THREE.Vector3(m * -0.012, 0.030, -0.012)
      : new THREE.Vector3(m * -0.006, 0.040, -0.030);
    const tip = opts.thumbForward
      ? new THREE.Vector3(m * -0.022, -0.012, -0.004)
      : new THREE.Vector3(m * -0.026, 0.028, -0.014);
    glove.push(segment(base, mid, 0.0115));
    glove.push(segment(mid, tip, 0.0100));
    const j = new THREE.SphereGeometry(0.012, 7, 6); j.translate(mid.x, mid.y, mid.z); glove.push(j);
    const web = box(0.026, 0.030, 0.026, 0.009); at(web, m * 0.016, 0.040, -0.014, 0.3, 0, m * -0.5); glove.push(web);
  }

  // Glove cuff with its strap, then the sleeve running back out of frame.
  glove.push(at(box(0.040, 0.026, 0.078, 0.011), m * 0.028, 0.066, -0.004));
  palm.push(at(box(0.043, 0.008, 0.080, 0.003), m * 0.028, 0.070, -0.004)); // the wrist strap (darker)
  const fa = opts.forearm ?? 0;
  if (fa > 0) {
    const arm = limb(0.034, 0.028, fa);
    if (opts.forearmDir) {
      const d = new THREE.Vector3(...opts.forearmDir).normalize();
      arm.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d));
      arm.translate(m * 0.028, 0.076, -0.006);
    } else {
      at(arm, m * 0.028, 0.076, -0.006, opts.forearmPitch ?? 0.9, m * (opts.forearmYaw ?? 0), 0);
    }
    sleeve.push(arm);
  }

  const group = new THREE.Group();
  for (const [parts, mat] of [[glove, GLOVE], [palm, PALM], [sleeve, SLEEVE]] as const) {
    if (!parts.length) continue;
    const mesh = new THREE.Mesh(merge(parts), mat);
    mesh.castShadow = false;      // a viewmodel is drawn over the world, not lit into it
    mesh.frustumCulled = false;   // it lives in front of the near plane; culling flickers it
    group.add(mesh);
  }
  group.scale.setScalar(s);
  return group;
}

// ── Per-weapon grips ──────────────────────────────────────────────────────────

/**
 * Where a weapon is held, MEASURED off the weapon itself.
 *
 * The obvious approach is a hand-tuned table of anchors per gun, the way GUN_FIX in
 * gunModels handles orientation. It was the first thing tried here and it is the
 * wrong tool: ten weapons from three pipelines (hand-authored GLB, image-to-3D, and
 * procedural) put their receivers at wildly different heights inside an identically
 * normalised bounding box, so ten triples have to be eyeballed, none of them can be
 * checked by anything but a screenshot, and an eleventh weapon starts the job again.
 *
 * So this measures instead. The gun is sliced along its barrel axis and the LOWEST
 * surface in each slice is recorded — that profile is the weapon's underside, which
 * is exactly the line a hand grips along, whatever the model's internal proportions.
 * A hand then sits at a given fraction along the weapon, raised to meet the underside
 * at that point. It costs one pass over the vertices per gun at load, and it is right
 * by construction on a model nobody has looked at yet.
 *
 * Two caveats it handles explicitly:
 *
 *  • The MAGAZINE is the lowest thing on most rifles, and it is not a grip. Slices
 *    are read at fractions chosen to sit behind it (the pistol grip) and well ahead
 *    of it (the handguard), and the depth is clamped so a deep magazine well cannot
 *    drag a hand down with it.
 *  • A PISTOL has no handguard to reach for, so both hands go to the one grip.
 */

/** Underside profile of a weapon: `minY[i]` is the lowest surface in slice i. */
interface Profile {
  minY: Float32Array;
  z0: number;
  dz: number;
  /** The weapon's typical underside — the median of the slices. Grips hang a little
   *  below this; a magazine or a drum hangs a long way below it. */
  body: number;
}

const SLICES = 48;

function underside(gun: THREE.Object3D, len: number): Profile {
  const minY = new Float32Array(SLICES).fill(Infinity);
  const z0 = -len / 2;
  const dz = len / SLICES;
  const v = new THREE.Vector3();

  gun.updateMatrixWorld(true);
  const toGun = new THREE.Matrix4().copy(gun.matrixWorld).invert();

  gun.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const toLocal = new THREE.Matrix4().multiplyMatrices(toGun, mesh.matrixWorld);
    const index = mesh.geometry.getIndex();
    const tris = index ? index.count : pos.count;

    // TRIANGLES, not vertices. A box carries vertices only at its corners, so a
    // 6cm-deep pistol grip lands entirely between two slice boundaries and every
    // slice across its middle comes back EMPTY — and half these weapons are built
    // out of boxes. Worse, those empty slices then skew the median that decides the
    // body line. Taking each triangle's z SPAN and stamping its lowest point across
    // every slice it crosses fills the faces in, which is what a flat underside
    // actually is.
    for (let t = 0; t < tris; t += 3) {
      let zMin = Infinity, zMax = -Infinity, yMin = Infinity;
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(t + k) : t + k;
        v.fromBufferAttribute(pos, vi).applyMatrix4(toLocal);
        if (v.z < zMin) zMin = v.z;
        if (v.z > zMax) zMax = v.z;
        if (v.y < yMin) yMin = v.y;
      }
      const from = Math.max(0, Math.floor((zMin - z0) / dz));
      const to = Math.min(SLICES - 1, Math.floor((zMax - z0) / dz));
      for (let s = from; s <= to; s++) if (yMin < minY[s]) minY[s] = yMin;
    }
  });

  const seen = Array.from(minY).filter(Number.isFinite).sort((a, b) => a - b);
  const body = seen.length ? seen[Math.floor(seen.length / 2)] : 0;
  return { minY, z0, dz, body };
}

/** The lowest surface at a fraction along the weapon (-0.5 = butt, +0.5 = muzzle).
 *  Slices nothing reached at all fall back to the nearest that something did. */
function undersideAt(p: Profile, len: number, frac: number): number {
  const z = frac * len;
  const s = Math.max(0, Math.min(SLICES - 1, Math.floor((z - p.z0) / p.dz)));
  for (let r = 0; r < SLICES; r++) {
    for (const i of [s - r, s + r]) {
      if (i >= 0 && i < SLICES && Number.isFinite(p.minY[i])) return p.minY[i];
    }
  }
  return 0;
}

/** Per-weapon deviations from "one hand back, one hand forward". Only the things
 *  measurement genuinely cannot know. */
interface GripTune {
  /** Fraction along the weapon for each hand. */
  fire: number;
  support: number | null;   // null = a pistol: both hands on the one grip
  scale?: number;
}

const GRIP: Record<GunId, GripTune> = {
  sidearm:         { fire: -0.30, support: null, scale: 0.94 }, // procedural pistol: grip behind the trigger guard
  smg:             { fire: -0.05, support: 0.22 },  // procedural SMG: support hand on the foregrip
  assault_rifle:   { fire: -0.09, support: 0.16 },
  marksman:        { fire: -0.26, support: 0.05 },  // procedural DMR: long stock, grip well back
  legendary:       { fire: -0.09, support: 0.15 },
  ashfall_carbine: { fire: -0.06, support: 0.18 },  // bullpup: grip is well forward
  warden_repeater: { fire: -0.10, support: 0.16 },
  rift_lance:      { fire: -0.11, support: 0.16 },
  seraph_lmg:      { fire: -0.10, support: 0.14, scale: 1.06 },
  ember_halo:      { fire: -0.09, support: 0.15 },
};


/**
 * Furthest a hand may sit below the weapon's own BODY LINE (the median underside).
 *
 * Relative, not absolute. A fixed ceiling sounds safer and is worse: set tight enough
 * to catch a drum magazine, it also caps every ordinary pistol grip, and then the
 * clamp — not the measurement — is deciding where every hand goes, which throws away
 * the whole reason for measuring. Against the body line, a grip hanging a few
 * centimetres under the receiver is normal and passes through untouched, while a mag
 * or a drum hanging 20cm down is the outlier it actually is.
 */
const MAX_BELOW_BODY = 0.07;

/**
 * The pair of hands for one weapon, in that weapon's own frame.
 *
 * Parent this to the GUN, not to the viewmodel group: the gun is what moves when you
 * aim down sights, when the weapon kicks, and when it is swapped or lowered against
 * a wall — hands attached to the gun inherit every one of those for free and can
 * never drift off the grip. Hands attached to the viewmodel would have to
 * re-implement all of it, and would be wrong the first time anyone retuned ADS.
 */
export function buildViewmodelHands(gunId: GunId, gun: THREE.Object3D, len: number): THREE.Group {
  const tune = GRIP[gunId] ?? GRIP.assault_rifle;
  const profile = underside(gun, len);
  const group = new THREE.Group();
  group.name = 'hands';

  /** Where a hand sits: along the weapon by fraction, up against its underside. */
  const anchor = (frac: number, sideways: number): [number, number, number] => {
    // HALFWAY between the weapon's body line and its lowest point here — which is
    // where a hand actually closes. Anchoring to the lowest point instead hangs the
    // hand off the very bottom of the grip, and a pistol grip is around 10cm deep,
    // so that is a hand dangling under the weapon rather than holding it.
    const mid = (profile.body + undersideAt(profile, len, frac)) / 2;
    return [sideways, Math.max(profile.body - MAX_BELOW_BODY, mid), frac * len];
  };

  // FIRING hand: right, on the pistol grip, forearm running back toward the shoulder.
  // The firing forearm is a CUFF STUB, not an arm. Anatomically the elbow tucks at
  // the ribs — but the ribs are behind the camera, so an arm drawn to true length
  // reaches within 20cm of the eye and becomes a tube over a quarter of the screen.
  // Worse, DOWN THE SIGHTS the weapon is raised and pulled toward centre, and that
  // tube lands square in the middle of the sight picture: measured against the same
  // frame with hands off, it was covering aim. The support arm can afford real
  // length because it hangs from a hand further down the barrel and leaves through
  // the bottom edge; this one cannot, so it stops at the wrist.
  const fire = buildHand({ scale: tune.scale ?? 1, curl: 1, gripRadius: 0.017, forearm: 0.06, forearmPitch: 0.55 });
  fire.position.set(...anchor(tune.fire, 0.004));
  fire.rotation.set(-0.16, 0, 0.10);   // wrist rake up the grip
  group.add(fire);

  if (tune.support !== null) {
    // SUPPORT hand: left, UNDER the handguard. The hand's grip axis is rolled onto
    // the barrel line (palm up, fingers wrapping up the far side, thumb over the
    // near side pointing at the muzzle), and its forearm runs back, down and out to
    // the left shoulder. That C-clamp is what reads as a rifle being held, not a
    // second pistol grip.
    const support = buildHand({
      left: true, scale: tune.scale ?? 1, curl: 0.62, gripRadius: 0.028, forearm: 0.16,
      thumbForward: true, forearmDir: [-0.55, 0.75, 0.42],
    });
    support.position.set(...anchor(tune.support, -0.004));
    support.name = 'support-hand';
    support.userData.restY = support.position.y;
    // Local X (palm side) -> up, local Y (wrist) -> back, local Z -> left; then the
    // wrist dropped a little so the arm comes from below.
    support.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)));
    support.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), -0.35);
    support.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), 0.25);
    group.add(support);
  } else {
    // A pistol is held in BOTH hands, stacked: the support hand wraps the firing
    // hand's fingers rather than reaching for a handguard that does not exist.
    const cup = buildHand({
      left: true, scale: (tune.scale ?? 1) * 0.96, curl: 0.5, gripRadius: 0.03, forearm: 0.10,
      forearmPitch: 0.5, forearmYaw: 0.3,
    });
    const [x, y, z] = anchor(tune.fire, -0.034);
    cup.position.set(x, y - 0.006, z - 0.012);
    cup.rotation.set(0.1, 0, -0.2);
    group.add(cup);
  }

  return group;
}
