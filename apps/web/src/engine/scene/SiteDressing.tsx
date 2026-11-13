'use client';

/**
 * The visual-only layer that makes each site a place (see siteLook.ts for the data and
 * the rules): the sky, the land beyond the fence, landmarks on the skyline, painted
 * signs and marks, ground wear and what drifts in the air. Nothing here collides, and
 * nothing solid-looking stands inside the playable bounds.
 *
 * Cost: the sky is one shader; terrain is two vertex-coloured strips; landmarks are a
 * few dozen plain meshes far out in the fog; marks, signs and wear are flat quads
 * (wear is instanced per kind); particles are one Points draw per kind. Particles and
 * moving smoke stop on the minimal tier and freeze under Reduce motion.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { buildTerrainApron } from './terrainRelief';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelDef } from '../fps/levels';
import type { ZoneTheme } from '../fps/campaign';
import { factionPaint as factionColor } from '@/lib/factions';
import { paintInsignia } from '@/lib/insignia';
import { LANDMARKS, MARKS, SIGN_WORDS, TERRAIN, airborne, groundWear, mixHex, perimeterWall, type Landmark, type Mark, type Phase } from './siteLook';
import { bannerTexture, hazardTexture, insigniaTexture, puffTexture, rng, stencilTexture, wearTexture } from './siteTextures';

// ── Sky ─────────────────────────────────────────────────────────────────────

const SKY_FRAG = `
varying vec3 vP;
uniform vec3 uTop, uBottom, uHaze, uSun, uSunColor, uGlowDir, uGlowColor;
uniform float uNight, uTime, uCloud, uSmog, uGlow;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  vec3 d = normalize(vP);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uBottom, uTop, pow(h, 0.8));
  // haze thickening toward the horizon (and the smog band over the refinery)
  float band = smoothstep(0.22 + uSmog * 0.18, -0.02, d.y);
  col = mix(col, uHaze, band * (0.55 + uSmog * 0.35));
  // sun: a hot disc and a wide glow; at night a pale moon instead
  float s = max(dot(d, uSun), 0.0);
  col += uSunColor * (pow(s, 900.0) * 2.4 * (1.0 - uNight) + pow(s, 14.0) * 0.22 * (1.0 - uNight * 0.8));
  col += vec3(0.75, 0.8, 0.9) * smoothstep(0.9993, 0.9996, s) * uNight * 0.9;
  // clouds: a drifting fbm deck, thinned at the zenith and gone below the horizon
  vec2 cp = d.xz / max(d.y + 0.14, 0.06) * 1.3 + vec2(uTime * 0.006, uTime * 0.002);
  float c = fbm(cp);
  float cover = smoothstep(0.62 - uCloud * 0.22, 0.86, c) * smoothstep(-0.01, 0.2, d.y);
  vec3 lit = mix(uHaze, vec3(1.0), 0.45 * (1.0 - uNight)) + uSunColor * pow(s, 4.0) * 0.25 * (1.0 - uNight);
  vec3 cloud = mix(lit, uHaze * 0.55, uSmog * 0.5);
  cloud = mix(cloud, uBottom * 0.6, uNight * 0.75);
  col = mix(col, cloud, cover * 0.85);
  // stars on clear night sky
  vec2 sp = floor(vec2(atan(d.z, d.x) * 180.0, d.y * 260.0));
  float star = step(0.9965, hash(sp)) * smoothstep(0.06, 0.35, d.y) * (1.0 - cover);
  col += vec3(0.85, 0.9, 1.0) * star * uNight * 0.7;
  // a warm glow on the low sky from something burning (the flare stack)
  float g = max(dot(normalize(vec3(d.x, 0.0, d.z)), uGlowDir), 0.0);
  col += uGlowColor * pow(g, 18.0) * smoothstep(0.35, 0.0, d.y) * uGlow;
  gl_FragColor = vec4(col, 1.0);
}`;

export function SiteSky({ theme, phase, level, sunDir, frozen }: { theme: ZoneTheme; phase: Phase; level: LevelDef; sunDir: THREE.Vector3; frozen: boolean }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() },
      uSun: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
      uGlowDir: { value: new THREE.Vector3(1, 0, 0) }, uGlowColor: { value: new THREE.Color('#ff7a2e') },
      uNight: { value: 0 }, uTime: { value: 0 }, uCloud: { value: 0.5 }, uSmog: { value: 0 }, uGlow: { value: 0 },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: SKY_FRAG,
  }), []);
  useEffect(() => {
    const u = mat.uniforms;
    (u.uTop.value as THREE.Color).set(theme.sky.top);
    (u.uBottom.value as THREE.Color).set(theme.sky.bottom);
    (u.uHaze.value as THREE.Color).set(theme.fog[0]);
    (u.uSun.value as THREE.Vector3).copy(sunDir).normalize();
    (u.uSunColor.value as THREE.Color).set(theme.sun.color);
    u.uNight.value = phase === 'night' ? 1 : 0;
    const cinder = level.id === 'cinder_yard';
    u.uSmog.value = cinder ? 1 : level.id === 'blacksite' ? 0.35 : 0.15;
    u.uCloud.value = level.id === 'blacksite' ? 0.9 : cinder ? 0.7 : 0.25;
    // the refinery's flare lights the low sky toward it
    const flare = level.art.find((a) => a.kind === 'stack');
    if (flare) (u.uGlowDir.value as THREE.Vector3).set(flare.x, 0, flare.z).normalize();
    u.uGlow.value = flare ? (phase === 'night' ? 0.55 : phase === 'dusk' ? 0.3 : 0.08) : 0;
  }, [theme, phase, level, sunDir, mat]);
  useFrame((_, dt) => { if (!frozen) mat.uniforms.uTime.value += dt; });
  return (
    <mesh scale={[300, 300, 300]} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[1, 48, 24]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

// ── Terrain ─────────────────────────────────────────────────────────────────

function profile(shape: 'mesa' | 'ridge' | 'flats', a: number, seed: number): number {
  const n = Math.sin(a * 3 + seed) * 0.5 + Math.sin(a * 7.3 + seed * 2.1) * 0.3 + Math.sin(a * 17.1 + seed * 3.7) * 0.15 + Math.sin(a * 41 + seed) * 0.05;
  if (shape === 'mesa') {
    // flat tops with steep sides: quantise into tiers with a narrow ramp between
    const tier = (t: number) => 1 / (1 + Math.exp(-(n - t) * 26));
    return 0.1 + 0.35 * tier(-0.15) + 0.55 * tier(0.32);
  }
  if (shape === 'ridge') return Math.pow(1 - Math.abs(Math.sin(a * 5 + seed + n)), 1.6) * 0.75 + (n * 0.5 + 0.5) * 0.25;
  return 0.35 + n * 0.3;
}

export function SiteTerrain({ level, phase, theme, center, minimal = false }: { level: LevelDef; phase: Phase; theme: ZoneTheme; center: [number, number]; minimal?: boolean }) {
  // The floor tint multiplies a dark ground texture; as a plain colour it read as a pale,
  // nearly white band between the yard and the hills. Taken down to about the
  // texture's own brightness first, then into the haze.
  const groundColor = useMemo(() => mixHex(mixHex(theme.floorTint, '#000000', 0.5), theme.fog[0], 0.3), [theme.floorTint, theme.fog]);
  const apron = useMemo(() => buildTerrainApron(level, minimal, groundColor), [level, minimal, groundColor]);
  useEffect(() => () => apron.dispose(), [apron]);
  const t = TERRAIN[level.id];
  const geo = useMemo(() => {
    const pos: number[] = [], col: number[] = [];
    const seg = 220;
    const haze = new THREE.Color(theme.fog[0]);
    const sunAz = Math.atan2(26, 22);
    t.rings.forEach(([R, base, relief], ri) => {
      const rock = new THREE.Color(t.rock[phase]).lerp(haze, t.veil[ri === 0 ? 0 : 1]);
      const foot = rock.clone().multiplyScalar(0.55).lerp(haze, 0.3);
      const seed = ri * 1.7 + (level.id.length % 5);
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        const h0 = base + relief * profile(t.shape, a0, seed), h1 = base + relief * profile(t.shape, a1, seed);
        const P = (a: number, y: number) => [center[0] + Math.cos(a) * R, y, center[1] + Math.sin(a) * R];
        const lit = (a: number) => rock.clone().multiplyScalar(0.78 + 0.42 * Math.max(0, Math.cos(a - sunAz + Math.PI)));
        const top0 = lit(a0), top1 = lit(a1);
        const v = [P(a0, -3), P(a1, -3), P(a0, h0), P(a1, -3), P(a1, h1), P(a0, h0)];
        const c = [foot, foot, top0, foot, top1, top0];
        v.forEach((p) => pos.push(...p));
        c.forEach((k) => col.push(k.r, k.g, k.b));
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [t, phase, theme.fog, level.id, center]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <group>
      <mesh geometry={geo} frustumCulled={false}>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} fog={false} />
      </mesh>
      {/* the land between the yard's floor and the ridges, fading into the haze */}
      <mesh geometry={apron} receiveShadow>
        <meshStandardMaterial color="#ffffff" vertexColors roughness={1} envMapIntensity={0.25} />
      </mesh>
    </group>
  );
}

// ── Landmarks ───────────────────────────────────────────────────────────────

/** Rising smoke or steam: billboards that climb, swell and thin, drifting downwind.
 *  One instanced draw per plume (a sprite each was a draw call each). */
const PLUME_VERT = `
attribute vec3 aOffset; attribute float aScale; attribute float aAlpha;
varying vec2 vUv; varying float vAlpha;
#include <fog_pars_vertex>
void main(){
  vUv = uv; vAlpha = aAlpha;
  vec4 mvPosition = modelViewMatrix * vec4(aOffset, 1.0);
  mvPosition.xy += position.xy * aScale;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const PLUME_FRAG = `
uniform sampler2D uMap; uniform vec3 uColor;
varying vec2 vUv; varying float vAlpha;
#include <fog_pars_fragment>
void main(){
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(uColor, t.a * vAlpha);
  #include <fog_fragment>
}`;
const PLUME_QUAD = new THREE.PlaneGeometry(1, 1);

function Plume({ x, y, z, scale, color, frozen, n = 9, rise = 26 }: { x: number; y: number; z: number; scale: number; color: string; frozen: boolean; n?: number; rise?: number }) {
  const { geo, mat, off, sc, al } = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.index = PLUME_QUAD.index;
    g.setAttribute('position', PLUME_QUAD.attributes.position);
    g.setAttribute('uv', PLUME_QUAD.attributes.uv);
    const off = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const sc = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    const al = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    g.setAttribute('aOffset', off); g.setAttribute('aScale', sc); g.setAttribute('aAlpha', al);
    g.instanceCount = n;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uColor: { value: new THREE.Color() } }]),
      vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG,
    });
    m.uniforms.uMap.value = puffTexture();
    return { geo: g, mat: m, off, sc, al };
  }, [n]);
  useEffect(() => { (mat.uniforms.uColor.value as THREE.Color).set(color); }, [color, mat]);
  useEffect(() => () => { geo.dispose(); (mat.uniforms.uMap.value as THREE.Texture)?.dispose(); mat.dispose(); }, [geo, mat]);
  const place = (t: number) => {
    for (let i = 0; i < n; i++) {
      const k = (t * 0.035 + i / n) % 1;
      off.setXYZ(i, x + k * rise * 0.55 + Math.sin(i * 1.7 + t * 0.2) * 0.8, y + k * rise, z + Math.cos(i * 2.3) * k * 2);
      sc.setX(i, scale * (1 + k * 3.2));
      al.setX(i, 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.15)));
    }
    off.needsUpdate = sc.needsUpdate = al.needsUpdate = true;
  };
  useEffect(() => { place(0); });
  useFrame((st) => { if (!frozen) place(st.clock.elapsedTime); });
  return <mesh geometry={geo} material={mat} frustumCulled={false} userData={{ dynamic: true }} />;
}

/** A searchlight beam that sweeps slowly (still under Reduce motion). */
function Searchlight({ y, phase, frozen, offset }: { y: number; phase: Phase; frozen: boolean; offset: number }) {
  const ref = useRef<THREE.Group>(null);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color('#dfe9ff') }, uK: { value: phase === 'night' ? 0.16 : 0.035 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uK; varying vec2 vUv; void main(){ float e = sin(vUv.x*3.14159); gl_FragColor = vec4(uColor,1.)*e*e*(0.15+0.85*vUv.y)*uK; }',
  }), [phase]);
  useFrame((st) => { if (ref.current && !frozen) ref.current.rotation.y = offset + Math.sin(st.clock.elapsedTime * 0.25 + offset) * 0.9; });
  return (
    <group ref={ref} position={[0, y, 0]} rotation={[0, offset, 0]} userData={{ dynamic: true }}>
      <group rotation={[-1.15, 0, 0]}>
        <mesh position={[0, -14, 0]} material={mat}><cylinderGeometry args={[0.3, 4.2, 28, 20, 1, true]} /></mesh>
      </group>
    </group>
  );
}

function LandmarkMesh({ l, mats, phase, frozen, flagTex, bounds }: { l: Landmark; mats: Record<string, THREE.Material>; phase: Phase; frozen: boolean; flagTex: THREE.Texture | null; bounds: LevelDef['bounds'] }) {
  const s = l.s ?? 1;
  const night = phase === 'night';
  switch (l.kind) {
    case 'water_tower':
      return (
        <group position={[l.x, 0, l.z]} scale={s}>
          {[[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]].map(([dx, dz], i) => <mesh key={i} position={[dx, 7, dz]} material={mats.steel}><cylinderGeometry args={[0.18, 0.24, 14, 6]} /></mesh>)}
          {[3.5, 8, 12.5].map((y) => <mesh key={y} position={[0, y, 0]} material={mats.steel}><boxGeometry args={[5.2, 0.15, 5.2]} /></mesh>)}
          <mesh position={[0, 17, 0]} material={mats.tank}><cylinderGeometry args={[4, 4, 6, 24]} /></mesh>
          <mesh position={[0, 21, 0]} material={mats.steel}><coneGeometry args={[4.3, 2.4, 24]} /></mesh>
          <mesh position={[0, 15.6, 0]} material={mats.band}><cylinderGeometry args={[4.03, 4.03, 0.7, 24]} /></mesh>
        </group>
      );
    case 'radio_mast':
      return (
        <group position={[l.x, 0, l.z]} scale={s}>
          {[0, 1, 2].map((i) => { const a = (i / 3) * Math.PI * 2; return <mesh key={i} position={[Math.cos(a) * 0.7, 20, Math.sin(a) * 0.7]} material={mats.mast}><cylinderGeometry args={[0.07, 0.07, 40, 4]} /></mesh>; })}
          {Array.from({ length: 13 }, (_, i) => <mesh key={i} position={[0, 1.5 + i * 3, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.mast}><torusGeometry args={[0.72, 0.05, 3, 3]} /></mesh>)}
          <mesh position={[0, 40.4, 0]}><sphereGeometry args={[0.35, 8, 6]} /><meshBasicMaterial color="#ff3b30" fog={false} /></mesh>
          <mesh position={[0, 26, 0]} rotation={[0, 0.4, 0]} material={mats.steel}><boxGeometry args={[0.5, 1.6, 0.5]} /></mesh>
        </group>
      );
    case 'quonset':
      return (
        <group position={[l.x, 0, l.z]} rotation={[0, l.rot ?? 0, 0]} scale={s}>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={mats.corrugated}><cylinderGeometry args={[4.5, 4.5, 16, 20, 1, false, -Math.PI / 2, Math.PI]} /></mesh>
          <mesh position={[0, 1.6, 8.02]} material={mats.dark}><boxGeometry args={[3.2, 3.2, 0.1]} /></mesh>
        </group>
      );
    case 'berm':
      return <mesh position={[l.x, -1.2 * s, l.z]} scale={[14 * s, 3.4 * s, 6 * s]} material={mats.sand}><sphereGeometry args={[1, 16, 8]} /></mesh>;
    case 'flag':
      return (
        <group position={[l.x, 0, l.z]}>
          <mesh position={[0, 4, 0]} material={mats.steel}><cylinderGeometry args={[0.05, 0.06, 8, 6]} /></mesh>
          {flagTex && <Flag tex={flagTex} frozen={frozen} />}
        </group>
      );
    case 'perimeter_wall':
      return (
        <group>
          {perimeterWall(bounds).map((b, i) => (
            <mesh key={i} position={[b.x, b.y, b.z]} material={mats[b.mat]}><boxGeometry args={[b.w, b.h, b.d]} /></mesh>
          ))}
        </group>
      );
    case 'guard_tower':
      return (
        <group position={[l.x, 0, l.z]}>
          {[[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]].map(([dx, dz], i) => <mesh key={i} position={[dx, 5, dz]} material={mats.steel}><boxGeometry args={[0.3, 10, 0.3]} /></mesh>)}
          <mesh position={[0, 11, 0]} material={mats.concrete}><boxGeometry args={[4.2, 2.2, 4.2]} /></mesh>
          <mesh position={[0, 11.6, 0]}><boxGeometry args={[4.25, 0.6, 4.25]} /><meshStandardMaterial color="#0b0e12" emissive={night ? '#ffd28a' : '#000'} emissiveIntensity={night ? 0.6 : 0} /></mesh>
          <mesh position={[0, 12.4, 0]} material={mats.dark}><boxGeometry args={[5, 0.3, 5]} /></mesh>
          {l.active && <Searchlight y={11.8} phase={phase} frozen={frozen} offset={Math.atan2(-l.x, -l.z)} />}
        </group>
      );
    case 'dish':
      return (
        <group position={[l.x, 0, l.z]} scale={s} rotation={[0, l.rot ?? 0, 0]}>
          <mesh position={[0, 3, 0]} material={mats.concrete}><cylinderGeometry args={[0.9, 1.3, 6, 10]} /></mesh>
          <mesh position={[0, 8, 0]} rotation={[-0.9, 0, 0]} material={mats.dish}><sphereGeometry args={[6, 24, 8, 0, Math.PI * 2, 0, 0.75]} /></mesh>
        </group>
      );
    case 'cooling_tower': {
      return (
        <group position={[l.x, 0, l.z]} scale={s}>
          <mesh material={mats.cooling}><primitive object={COOLING} attach="geometry" /></mesh>
          {l.active && <Plume x={0} y={30} z={0} scale={9} color="#e9e6e0" frozen={frozen} rise={34} n={10} />}
        </group>
      );
    }
    case 'chimney':
      return (
        <group position={[l.x, 0, l.z]} scale={s}>
          <mesh position={[0, 18, 0]} material={mats.brick}><cylinderGeometry args={[1.2, 1.9, 36, 14]} /></mesh>
          {[31, 34].map((y) => <mesh key={y} position={[0, y, 0]} material={mats.band}><cylinderGeometry args={[1.32, 1.36, 1.2, 14]} /></mesh>)}
          {l.active && <Plume x={0} y={36.5} z={0} scale={3.2} color={night ? '#3a302a' : '#55504a'} frozen={frozen} rise={30} />}
        </group>
      );
    case 'refinery':
      return (
        <group position={[l.x, 0, l.z]} scale={s}>
          {[[-4, 0, 1.4, 22], [0, -3, 1.8, 28], [4, 1, 1.2, 18], [1, 5, 1, 14]].map(([dx, dz, r, h], i) => <mesh key={i} position={[dx, h / 2, dz]} material={mats.tank}><cylinderGeometry args={[r, r, h, 12]} /></mesh>)}
          {[6, 11, 16].map((y) => <mesh key={y} position={[0, y, 0]} material={mats.steel}><boxGeometry args={[11, 0.2, 9]} /></mesh>)}
          <mesh position={[-7, 4, 4]} material={mats.tank}><cylinderGeometry args={[4, 4, 8, 18]} /></mesh>
        </group>
      );
    case 'pipe_bridge':
      return (
        <group position={[l.x, 0, l.z]}>
          {[-30, -15, 0, 15, 30].map((x) => <group key={x}>{[-1.5, 1.5].map((dz) => <mesh key={dz} position={[x, 4.5, dz]} material={mats.steel}><boxGeometry args={[0.4, 9, 0.4]} /></mesh>)}<mesh position={[x, 9, 0]} material={mats.steel}><boxGeometry args={[0.4, 0.4, 3.4]} /></mesh></group>)}
          {[[-0.9, 9.6, 0.6], [0, 9.7, 0.8], [0.9, 9.55, 0.5]].map(([dz, y, r]) => <mesh key={dz} position={[0, y, dz]} rotation={[0, 0, Math.PI / 2]} material={mats.pipe}><cylinderGeometry args={[r / 2, r / 2, 66, 10]} /></mesh>)}
        </group>
      );
  }
  return null;
}

/** Bakes every static mesh under it into one mesh per material, so a skyline of a few
 *  dozen parts costs a handful of draw calls. Meshes marked `userData.dynamic` (smoke,
 *  searchlights, flags) are left alone and keep animating. */
function MergeStatic({ children }: { children: React.ReactNode }) {
  const src = useRef<THREE.Group>(null);
  const [merged, setMerged] = useState<THREE.Mesh[]>([]);
  useLayoutEffect(() => {
    const g = src.current;
    if (!g) return;
    g.updateWorldMatrix(true, true);
    const inv = g.matrixWorld.clone().invert();
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const hidden: THREE.Mesh[] = [];
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.dynamic || (m as THREE.InstancedMesh).isInstancedMesh) return;
      let dyn = false;
      for (let p: THREE.Object3D | null = m; p && p !== g; p = p.parent) if (p.userData.dynamic) dyn = true;
      if (dyn || Array.isArray(m.material)) return;
      const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!geo.attributes.uv) return;
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      const list = byMat.get(m.material as THREE.Material) ?? [];
      list.push(geo);
      byMat.set(m.material as THREE.Material, list);
      hidden.push(m);
    });
    const out: THREE.Mesh[] = [];
    for (const [mat, geos] of byMat) {
      const one = mergeGeometries(geos, false);
      geos.forEach((x) => x.dispose());
      if (one) out.push(new THREE.Mesh(one, mat));
    }
    hidden.forEach((m) => { m.visible = false; });
    setMerged(out);
    return () => { out.forEach((m) => m.geometry.dispose()); hidden.forEach((m) => { m.visible = true; }); };
  }, []);
  return (
    <>
      <group ref={src}>{children}</group>
      {merged.map((m) => <primitive key={m.uuid} object={m} />)}
    </>
  );
}

/** A hyperboloid cooling-tower shell. */
const COOLING = (() => {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 20; i++) {
    const y = (i / 20) * 30;
    const k = (y - 21) / 21;
    pts.push(new THREE.Vector2(8 + 7 * k * k, y));
  }
  return new THREE.LatheGeometry(pts, 32);
})();

/** The holder's flag, rippling in the wind. */
function Flag({ tex, frozen }: { tex: THREE.Texture; frozen: boolean }) {
  const geo = useMemo(() => new THREE.PlaneGeometry(2.4, 1.5, 16, 6).translate(1.2, 0, 0), []);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array as Float32Array), [geo]);
  useFrame((st) => {
    if (frozen) return;
    const p = geo.attributes.position as THREE.BufferAttribute;
    const t = st.clock.elapsedTime;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3];
      p.setZ(i, Math.sin(x * 2.2 - t * 4) * 0.12 * x);
    }
    p.needsUpdate = true;
  });
  return (
    <mesh geometry={geo} position={[0.05, 7.1, 0]} userData={{ dynamic: true }}>
      <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.9} />
    </mesh>
  );
}

// ── Signs and marks ─────────────────────────────────────────────────────────

const FACE: Record<Mark['facing'], { rot: number; n: [number, number] }> = {
  '+z': { rot: 0, n: [0, 1] }, '-z': { rot: Math.PI, n: [0, -1] }, '+x': { rot: Math.PI / 2, n: [1, 0] }, '-x': { rot: -Math.PI / 2, n: [-1, 0] },
};

function Marks({ level, holder }: { level: LevelDef; holder: string | null }) {
  const items = useMemo(() => MARKS[level.id].map((m, i) => {
    const seed = i * 97 + level.id.length * 13;
    const map = m.kind === 'insignia' ? insigniaTexture(holder, m.color ?? factionColor(holder), seed)
      : m.kind === 'hazard' ? hazardTexture(m.w / m.h, seed)
      : stencilTexture(m.text ?? '', m.w / m.h, m.color ?? '#e9e4d6', seed);
    const mat = new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.05, roughness: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return { m, mat };
  }), [level.id, holder]);
  useEffect(() => () => items.forEach(({ mat }) => { mat.map?.dispose(); mat.dispose(); }), [items]);
  return (
    <group>
      {items.map(({ m, mat }, i) => {
        const f = FACE[m.facing];
        return (
          <mesh key={i} position={[m.x + f.n[0] * 0.012, m.y, m.z + f.n[1] * 0.012]} rotation={[0, f.rot, 0]} material={mat}>
            <planeGeometry args={[m.w, m.h]} />
          </mesh>
        );
      })}
    </group>
  );
}

function Signs({ level, holder }: { level: LevelDef; holder: string | null }) {
  const items = useMemo(() => level.art.filter((a) => a.kind === 'sign' && a.w).flatMap((a, i) => {
    const words = SIGN_WORDS[level.id][`${a.x},${a.z}`];
    if (!words) return [];
    const side = Math.abs(Math.sin(a.rot ?? 0)) > 0.5;
    const w = a.w! * 0.98, h = 0.68;
    return (['front', 'back'] as const).map((which, k) => {
      const map = bannerTexture({ ...words[which], color: a.color ?? '#c9a227', holder, holderColor: factionColor(holder), aspect: w / h, seed: i * 31 + k });
      const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.75, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const s = k === 0 ? 1 : -1, off = 0.052 * s;
      const rot = (side ? Math.PI / 2 : 0) + (k === 0 ? 0 : Math.PI);
      return { key: `${i}${which}`, mat, pos: [a.x + (side ? off : 0), a.h ?? 2.5, a.z + (side ? 0 : off)] as [number, number, number], rot, w, h };
    });
  }), [level, holder]);
  useEffect(() => () => items.forEach(({ mat }) => { mat.map?.dispose(); mat.dispose(); }), [items]);
  return <group>{items.map((s) => <mesh key={s.key} position={s.pos} rotation={[0, s.rot, 0]} material={s.mat}><planeGeometry args={[s.w, s.h]} /></mesh>)}</group>;
}

// ── Ground wear ─────────────────────────────────────────────────────────────

function Wear({ level, phase }: { level: LevelDef; phase: Phase }) {
  const sets = useMemo(() => groundWear(level.id, phase).map((w, k) => {
    const r = rng(1000 + k * 77 + level.id.length);
    const b = level.bounds;
    const roads = level.art.filter((a) => a.kind === 'road');
    const map = wearTexture(w.kind, 50 + k);
    const puddle = w.kind === 'puddle';
    const mat = new THREE.MeshStandardMaterial({
      map, transparent: true, depthWrite: false, roughness: puddle ? 0.06 : 1, metalness: puddle ? 0.3 : 0,
      color: puddle ? '#6a7682' : '#ffffff', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const items: { x: number; z: number; s: number; l: number; ry: number }[] = [];
    for (let i = 0; i < w.count; i++) {
      if (w.kind === 'tracks' && roads.length) {
        const rd = roads[i % roads.length];
        items.push({ x: rd.x + (r() - 0.5) * (rd.w ?? 6) * 0.5, z: rd.z + (r() - 0.5) * (rd.d ?? 30) * 0.8, s: 2.2, l: 9 + r() * 6, ry: (r() - 0.5) * 0.12 });
      } else if (w.kind === 'sand') {
        // drifts pile against the fence lines and walls at the edges
        const edge = r() < 0.5;
        const x = edge ? (r() < 0.5 ? b.minX + 1 + r() * 4 : b.maxX - 1 - r() * 4) : b.minX + r() * (b.maxX - b.minX);
        const z = edge ? b.minZ + r() * (b.maxZ - b.minZ) : (r() < 0.5 ? b.minZ + 1 + r() * 4 : b.maxZ - 1 - r() * 4);
        items.push({ x, z, s: 3 + r() * 5, l: 1, ry: r() * Math.PI });
      } else {
        items.push({ x: b.minX + 2 + r() * (b.maxX - b.minX - 4), z: b.minZ + 2 + r() * (b.maxZ - b.minZ - 4), s: (w.kind === 'puddle' ? 1.6 : 1) + r() * (w.kind === 'crack' ? 2 : 2.6), l: 1, ry: r() * Math.PI });
      }
    }
    return { key: `${w.kind}${k}`, mat, items, tall: w.kind === 'tracks' };
  }), [level, phase]);
  useEffect(() => () => sets.forEach(({ mat }) => { mat.map?.dispose(); mat.dispose(); }), [sets]);
  return <group>{sets.map((s) => <WearSet key={s.key} mat={s.mat} items={s.items} tall={s.tall} />)}</group>;
}

const QUAD = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
function WearSet({ mat, items, tall }: { mat: THREE.Material; items: { x: number; z: number; s: number; l: number; ry: number }[]; tall: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach((it, i) => {
      o.position.set(it.x, 0.018 + i * 0.0004, it.z);
      o.rotation.set(0, it.ry, 0);
      o.scale.set(it.s, 1, tall ? it.l : it.s);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items, tall, mat]);
  return <instancedMesh ref={ref} args={[QUAD, mat, items.length]} receiveShadow renderOrder={1} />;
}

// ── Air ─────────────────────────────────────────────────────────────────────

const AIR_VERT = `
uniform vec3 uCam; uniform float uTime, uSize, uBox, uKind;
attribute float aSeed;
varying float vA;
void main(){
  vec3 p = position;
  float t = uTime;
  vec3 drift = uKind < 0.5 ? vec3(2.4, sin(t * 0.7 + aSeed * 6.0) * 0.25, 0.8)   // dust: blown across
    : uKind < 2.5 ? vec3(0.6, -13.0, 0.2)                                         // rain: falls
    : vec3(0.7 + sin(aSeed * 9.0 + t * 0.6) * 0.5, -0.55, 0.3);                 // ash: drifts down
  vec3 w = p + drift * t;
  // wrap the field around the camera so it always surrounds the player
  vec3 local = mod(w - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  local.y = mod(w.y - uCam.y + 4.0, 14.0) - 4.0;
  vec4 mv = modelViewMatrix * vec4(uCam + local, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  gl_PointSize = min(uSize * (300.0 / max(dist, 0.5)), 24.0);
  vA = smoothstep(uBox * 0.5, uBox * 0.25, length(local.xz)) * smoothstep(0.3, 2.0, dist);
}`;
const AIR_FRAG = `
uniform vec3 uColor; uniform float uKind, uAlpha;
varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float a;
  if (uKind > 1.5 && uKind < 2.5) a = smoothstep(0.06, 0.0, abs(c.x)) * smoothstep(0.5, 0.1, abs(c.y)); // a rain streak
  else a = smoothstep(0.5, 0.0, length(c));
  gl_FragColor = vec4(uColor, a * vA * uAlpha);
}`;

const KIND_CODE = { dust: 0, rain: 2, ash: 3 } as const;

function AirField({ kind, count, color, frozen, ember }: { kind: keyof typeof KIND_CODE; count: number; color: string; frozen: boolean; ember: boolean }) {
  const { camera } = useThree();
  const box = kind === 'rain' ? 26 : 34;
  const geo = useMemo(() => {
    const r = rng(kind.length * 31 + count);
    const p = new Float32Array(count * 3), s = new Float32Array(count);
    for (let i = 0; i < count; i++) { p[i * 3] = r() * box; p[i * 3 + 1] = r() * 14; p[i * 3 + 2] = r() * box; s[i] = r(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
    return g;
  }, [kind, count, box]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: ember ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: box }, uKind: { value: KIND_CODE[kind] },
      uSize: { value: kind === 'rain' ? 0.22 : kind === 'ash' ? 0.05 : 0.035 },
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: kind === 'rain' ? 0.35 : ember ? 0.9 : 0.55 },
    },
    vertexShader: AIR_VERT, fragmentShader: AIR_FRAG,
  }), [kind, color, box, ember]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame((_, dt) => {
    (mat.uniforms.uCam.value as THREE.Vector3).copy(camera.position);
    if (!frozen) mat.uniforms.uTime.value += Math.min(dt, 0.05);
  });
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={2} />;
}

// ── The whole layer ─────────────────────────────────────────────────────────

export function SiteDressing({ level, theme, phase, holder, minimal, frozen, particles }: {
  level: LevelDef; theme: ZoneTheme; phase: Phase;
  /** The faction that holds this site (its insignia goes on the walls and flags). */
  holder: string | null;
  minimal: boolean; frozen: boolean; particles: boolean;
}) {
  const center = useMemo<[number, number]>(() => [(level.bounds.minX + level.bounds.maxX) / 2, (level.bounds.minZ + level.bounds.maxZ) / 2], [level.bounds]);
  const mats = useMemo(() => {
    const std = (color: string, roughness = 0.8, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    return {
      steel: std('#4e5257', 0.55, 0.7), tank: std('#b8b2a4', 0.5, 0.4), band: std('#a33a26', 0.6, 0.2), mast: std('#c9c4bb', 0.6, 0.6),
      corrugated: std('#7d766a', 0.7, 0.45), dark: std('#1c1e21', 0.8, 0.3), sand: std(phase === 'night' ? '#3e3a36' : '#b89a72', 1, 0),
      concrete: std('#7b7f84', 0.92, 0.05), wallConc: std('#5c6066', 0.95, 0.05), wire: new THREE.MeshStandardMaterial({ color: '#8a8d90', roughness: 0.5, metalness: 0.8, wireframe: true }),
      dish: std('#d6d9dc', 0.4, 0.5), cooling: std('#8a857c', 0.95, 0), brick: std('#6e4a3a', 0.9, 0.05), pipe: std('#7a7d80', 0.45, 0.7),
    } as Record<string, THREE.Material>;
  }, [phase]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const flagTex = useMemo(() => (LANDMARKS[level.id].some((l) => l.kind === 'flag') ? flagTexture(holder) : null), [level.id, holder]);
  return (
    <group>
      <SiteTerrain level={level} phase={phase} theme={theme} center={center} minimal={minimal} />
      {!minimal && (
        <MergeStatic key={`${level.id}-${phase}`}>
          {LANDMARKS[level.id].map((l, i) => <LandmarkMesh key={i} l={l} mats={mats} phase={phase} frozen={frozen} flagTex={flagTex} bounds={level.bounds} />)}
        </MergeStatic>
      )}
      <Signs level={level} holder={holder} />
      <Marks level={level} holder={holder} />
      {!minimal && <Wear level={level} phase={phase} />}
      {particles && !minimal && airborne(level.id, phase).map((p) => (
        <AirField key={p.kind} kind={p.kind} count={p.count} color={p.color} frozen={frozen} ember={p.kind === 'ash' && phase === 'night'} />
      ))}
    </group>
  );
}

function flagTexture(holder: string | null): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#23262b'; g.fillRect(0, 0, 256, 160);
  g.fillStyle = factionColor(holder); g.fillRect(0, 0, 256, 14); g.fillRect(0, 146, 256, 14);
  paintInsignia(g, holder, 128 - 52, 80 - 52, 104, factionColor(holder), 1.6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
