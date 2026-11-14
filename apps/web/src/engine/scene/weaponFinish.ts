import * as THREE from 'three';

/**
 * @module scene/weaponFinish
 * @description The surface finish of a weapon, without a texture.
 *
 * The authored guns carry no UVs (see scripts/build-visual-kit.mjs), so there is no
 * place for a normal map or a roughness map to live. What they have instead is a
 * baked wear mask in the vertex colours (COLOR_0: r = how sharp the edge is at the
 * vertex, g = how much the surface faces up) and a known object space. That is enough
 * to do, in the shader, what a texture set would otherwise do:
 *
 *  • EDGE WEAR. Paint and phosphate wear through on the edges first: the mask blends
 *    the finish toward the bare metal under it (lighter, more metallic, smoother),
 *    broken up by noise so it reads as rubbed rather than outlined.
 *  • GRAIN. A fine object-space noise modulates roughness, so flat faces catch light
 *    unevenly the way bead-blasted alloy and moulded polymer do instead of as one
 *    uniform sheen.
 *  • GRIME. A slower, blotchier noise darkens and roughens: carbon and oil in the
 *    recesses, dust on the upward faces (the g channel).
 *  • SCRATCHES. Thin streaks along the barrel axis, faint, where a weapon is handled.
 *
 * All of it is procedural, costs a handful of ALU per fragment on a few thousand
 * pixels, and loads nothing. Applied once per material at prototype build; the
 * material keeps three's full standard pipeline (lights, shadows, env map, fog).
 */

export interface FinishOptions {
  /** The bare metal exposed where the finish wears off. */
  wear?: { color: THREE.ColorRepresentation; metalness: number; roughness: number };
  /** How far the edge mask is allowed to wear the finish through, 0..1. */
  wearAmount?: number;
  /** Grime darkening, 0..1. */
  grime?: number;
  /** Roughness grain, 0..1. */
  grain?: number;
  /** Scratch strength, 0..1. */
  scratches?: number;
}

const DEFAULT_WEAR = { color: '#9ea4aa', metalness: 0.95, roughness: 0.28 };

/**
 * Patch a MeshStandardMaterial in place with the finish. Returns the same material.
 * The material must be unique to its weapon (clone shared ones first).
 */
export function applyWeaponFinish(mat: THREE.MeshStandardMaterial, opts: FinishOptions = {}): THREE.MeshStandardMaterial {
  const wear = opts.wear ?? DEFAULT_WEAR;
  const uniforms = {
    uWearColor: { value: new THREE.Color(wear.color) },
    uWearMetal: { value: wear.metalness },
    uWearRough: { value: wear.roughness },
    uWearAmt: { value: opts.wearAmount ?? 0.75 },
    uGrime: { value: opts.grime ?? 0.35 },
    uGrain: { value: opts.grain ?? 0.5 },
    uScratch: { value: opts.scratches ?? 0.35 },
  };
  // The mask is read by hand, not through three's vertexColors path: that path would
  // multiply the diffuse by a near-black mask and turn the whole weapon dark.
  mat.vertexColors = false;
  const previous = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFinPos;
        varying vec3 vFinNrm;
        varying vec2 vFinMask;
        #ifndef USE_COLOR
        attribute vec3 color;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFinPos = transformed;
        vFinNrm = objectNormal;
        vFinMask = color.rg;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFinPos;
        varying vec3 vFinNrm;
        varying vec2 vFinMask;
        uniform vec3 uWearColor;
        uniform float uWearMetal, uWearRough, uWearAmt, uGrime, uGrain, uScratch;
        float finHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float finNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(finHash(i), finHash(i + vec2(1, 0)), f.x), mix(finHash(i + vec2(0, 1)), finHash(i + vec2(1, 1)), f.x), f.y);
        }
        // Object-space hard triplanar: the dominant axis of the object normal picks the plane.
        vec2 finUv(vec3 p, vec3 n) {
          vec3 a = abs(n);
          if (a.x >= a.y && a.x >= a.z) return p.zy;
          if (a.y >= a.z) return p.xz;
          return p.xy;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 finN = normalize(vFinNrm);
        vec2 finP = finUv(vFinPos, finN);
        float finGrain = finNoise(finP * 420.0) * 0.6 + finNoise(finP * 1300.0 + 3.1) * 0.4;
        float finBlotch = finNoise(finP * 38.0 + 7.3) * 0.65 + finNoise(finP * 95.0 + 1.7) * 0.35;
        // Grime gathers in the blotches and on upward faces; it darkens and dulls.
        float finGrime = uGrime * smoothstep(0.42, 0.78, finBlotch) * (0.55 + 0.45 * vFinMask.g);
        // Edge wear: the baked edge, thinned by noise so it never reads as a stroke.
        float finWear = uWearAmt * vFinMask.r * smoothstep(0.25, 0.7, finBlotch * 0.5 + finGrain * 0.5 + vFinMask.r * 0.35);
        // Scratches along the long axis: a stretched noise thresholded to thin lines.
        float finScr = uScratch * smoothstep(0.80, 0.86, finNoise(vec2(vFinPos.z * 9.0 + finP.y * 2.0, finP.y * 520.0 + finP.x * 300.0))) * (1.0 - finWear);
        diffuseColor.rgb *= 1.0 - finGrime * 0.35;
        diffuseColor.rgb = mix(diffuseColor.rgb, uWearColor, finWear);
        diffuseColor.rgb += uWearColor * finScr * 0.25;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 1.0 + (finGrain - 0.5) * 0.5 * uGrain;
        roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor + 0.22), finGrime);
        roughnessFactor = mix(roughnessFactor, uWearRough, finWear);
        roughnessFactor = mix(roughnessFactor, uWearRough, finScr * 0.6);
        roughnessFactor = clamp(roughnessFactor, 0.04, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, uWearMetal, finWear);`);
  };
  const key = mat.customProgramCacheKey();
  mat.customProgramCacheKey = () => `${key}:weaponFinish`;
  mat.needsUpdate = true;
  return mat;
}

/** Per authored material (by the name baked into the GLB), how it wears. */
const BY_NAME: Record<string, FinishOptions> = {
  'phosphated alloy': { wear: { color: '#8e949a', metalness: 0.95, roughness: 0.32 }, wearAmount: 0.45, grime: 0.4, grain: 0.6, scratches: 0.35 },
  // Rail teeth and controls are all chamfer: the mask is high everywhere on them, so
  // they wear gently or they turn white.
  'machined steel': { wear: { color: '#9aa0a5', metalness: 1, roughness: 0.26 }, wearAmount: 0.18, grime: 0.3, grain: 0.35, scratches: 0.25 },
  'reinforced polymer': { wear: { color: '#7f7868', metalness: 0.05, roughness: 0.62 }, wearAmount: 0.3, grime: 0.3, grain: 0.7, scratches: 0.1 },
  rubber: { wear: { color: '#34393a', metalness: 0, roughness: 0.78 }, wearAmount: 0.3, grime: 0.2, grain: 0.5, scratches: 0 },
  'powder coat': { wear: { color: '#8f959b', metalness: 0.9, roughness: 0.36 }, wearAmount: 0.4, grime: 0.45, grain: 0.5, scratches: 0.25 },
};

/** Default for materials the table does not name (the procedural guns, the blaster). */
const GENERIC: FinishOptions = { wearAmount: 0, grime: 0.25, grain: 0.5, scratches: 0.2 };

/**
 * Give every mesh under `root` its own finished material. Shared materials are cloned
 * per distinct source once, so a weapon with five materials still compiles five
 * programs, not one per mesh. Glass and emissive parts are left alone.
 */
export function finishWeapon(root: THREE.Object3D): void {
  const done = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.Material;
    if (Array.isArray(src)) return;
    let out = done.get(src);
    if (!out) {
      const std = src as THREE.MeshStandardMaterial;
      const glassy = std.transparent || (std.emissive && std.emissiveIntensity > 0.5 && std.emissive.getHex() !== 0);
      if (!std.isMeshStandardMaterial || glassy) out = src;
      else {
        const c = std.clone();
        // Steel reflects the sky; the authored values were written expecting an environment.
        c.envMapIntensity = Math.max(c.envMapIntensity, 1.4);
        out = applyWeaponFinish(c, BY_NAME[std.name] ?? GENERIC);
      }
      done.set(src, out);
    }
    mesh.material = out;
  });
}
