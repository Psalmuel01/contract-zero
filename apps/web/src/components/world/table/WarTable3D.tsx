'use client'

// The War Table as a physical sand table: a relief of the frontier under a lamp, a
// miniature for every facility, readiness rings on the ground, markers for what is
// happening there, and convoys on the road at the server's own progress. It reads
// exactly the model the 2D table reads (lib/world/table): positions are schematic
// slots, never survey data, and it says so on the frame.
//
// Selecting a facility (click or tap a miniature, or the list below the map) focuses the
// camera on it and lays out its owner's real stock beside it: crates, cases and drums
// in six slots each, filled by stock over target, so 5 and 5,000 draw alike.
//
// Cost: one relief draw, a few dozen small meshes, one shadow map; the frame loop
// stops when the tab is hidden, and Reduce motion cuts every tween and pulse.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { factionPaint } from '@/lib/factions'
import { supplySlots, TABLE_VIEW, type TableConvoy, type TableFacility, type TableModel, type Pt } from '@/lib/world/table'
import type { ResourceName } from '@/lib/api'
import { usePageVisible } from '@/lib/usePageVisible'
import type { FacilityStatus, Tone } from './WarTable'

/** Schematic table units (the 2D view box) to metres on the sand table. */
const K = 1 / 20
export const toTable = (p: Pt): [number, number] => [(p.x - TABLE_VIEW.w / 2) * K, (p.y - TABLE_VIEW.h / 2) * K]
const W = TABLE_VIEW.w * K + 3, D = TABLE_VIEW.h * K + 3

const TONE_HEX: Record<Tone, string> = { ok: '#46c37b', warn: '#f0a03c', critical: '#e5484d', info: '#6fa3c7' }
const RES_HEX: Record<ResourceName, string> = { ammo: '#f0a03c', med: '#46c37b', fuel: '#6fa3c7' }

export interface FacilitySupply { resource: ResourceName; stock: number; target: number }

// ── Relief ──────────────────────────────────────────────────────────────────

/** Height of the relief at (x, z): rolling ground, a ridge line, and level pads under
 *  each miniature and along the road, so models sit flat and convoys ride the road. */
function heightAt(x: number, z: number, pads: [number, number][], roadZ: number): number {
  let h = 0.35 * Math.sin(x * 0.45 + 1.3) * Math.cos(z * 0.6) + 0.22 * Math.sin(x * 1.1 + z * 0.8) + 0.12 * Math.sin(x * 2.3 - z * 1.7)
  h += 0.9 * Math.exp(-Math.pow((z + 3.2 + Math.sin(x * 0.3) * 1.2) / 1.6, 2)) * (0.6 + 0.4 * Math.sin(x * 0.7)) // the northern ridge
  h = Math.max(h, -0.25) + 0.25
  // fall away to the table's lip at the edges, so no ridge pokes over the frame
  const ex = Math.min(1, (W / 2 - 0.6 - Math.abs(x)) / 2.2), ez = Math.min(1, (D / 2 - 0.6 - Math.abs(z)) / 2.2)
  h *= Math.max(0, Math.min(ex, ez))
  let flat = 0
  for (const [px, pz] of pads) flat = Math.max(flat, Math.exp(-((x - px) ** 2 + (z - pz) ** 2) / 1.6))
  flat = Math.max(flat, Math.exp(-((z - roadZ) ** 2) / 0.35))
  return h * (1 - flat) + 0.18 * flat
}

const RELIEF_VERT = `
varying vec3 vN; varying vec3 vW; varying float vH;
void main(){
  vN = normalize(normalMatrix * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vH = position.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`
const RELIEF_FRAG = `
uniform vec3 uLight; uniform vec3 uTerr[6]; uniform vec3 uTerrColor[6]; uniform int uTerrN; uniform vec2 uFocus; uniform float uFocusOn;
varying vec3 vN; varying vec3 vW; varying float vH;
void main(){
  vec3 low = vec3(0.11, 0.115, 0.12), high = vec3(0.36, 0.33, 0.28);
  vec3 col = mix(low, high, smoothstep(0.1, 1.3, vH));
  // faction territories: a soft wash of the holder's colour
  for (int i = 0; i < 6; i++) {
    if (i >= uTerrN) break;
    float d = length(vW.xz - uTerr[i].xy) / uTerr[i].z;
    col = mix(col, uTerrColor[i] * 0.55, smoothstep(1.0, 0.55, d) * 0.28);
    col += uTerrColor[i] * smoothstep(0.035, 0.0, abs(d - 1.0)) * 0.35; // the border
  }
  float lit = 0.38 + 0.8 * max(dot(normalize(vN), normalize(uLight)), 0.0);
  col *= lit;
  // contour lines every 0.12 m of height, and a survey grid
  float c = abs(fract(vH / 0.2) - 0.5) / fwidth(vH / 0.2);
  col += vec3(0.95, 0.62, 0.24) * (1.0 - smoothstep(0.0, 1.1, c)) * 0.13;
  vec2 g = abs(fract(vW.xz / 2.0) - 0.5) / fwidth(vW.xz / 2.0);
  col += vec3(0.45, 0.6, 0.72) * (1.0 - smoothstep(0.0, 1.0, min(g.x, g.y))) * 0.06;
  // the focused facility is lit by a pool of light
  float f = length(vW.xz - uFocus);
  col *= 1.0 + uFocusOn * 0.35 * smoothstep(3.2, 0.0, f);
  gl_FragColor = vec4(col, 1.0);
}`

function Relief({ model, focus }: { model: TableModel; focus: [number, number] | null }) {
  const pads = useMemo(() => model.facilities.map((f) => toTable(f.pos)), [model.facilities])
  const roadZ = toTable(model.offMap)[1]
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(W - 1, D - 1, 190, 90).rotateX(-Math.PI / 2)
    const p = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i), pads, roadZ))
    g.computeVertexNormals()
    return g
  }, [pads, roadZ])
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: RELIEF_VERT, fragmentShader: RELIEF_FRAG,
    uniforms: {
      uLight: { value: new THREE.Vector3(-0.4, 1, 0.5) },
      uTerr: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
      uTerrColor: { value: Array.from({ length: 6 }, () => new THREE.Color()) },
      uTerrN: { value: 0 }, uFocus: { value: new THREE.Vector2() }, uFocusOn: { value: 0 },
    },
  }), [])
  useEffect(() => {
    const ts = model.territories.slice(0, 6)
    ts.forEach((t, i) => {
      const fs = model.facilities.filter((f) => t.facilityIds.includes(f.id)).map((f) => toTable(f.pos))
      const [ax, az] = toTable(t.anchor)
      const r = Math.max(...fs.map(([x, z]) => Math.hypot(x - ax, z - az))) + 2.6
      ;(mat.uniforms.uTerr.value[i] as THREE.Vector3).set(ax, az, r)
      ;(mat.uniforms.uTerrColor.value[i] as THREE.Color).set(factionPaint(t.owner))
    })
    mat.uniforms.uTerrN.value = ts.length
  }, [model, mat])
  useEffect(() => {
    if (focus) (mat.uniforms.uFocus.value as THREE.Vector2).set(focus[0], focus[1])
    mat.uniforms.uFocusOn.value = focus ? 1 : 0
  }, [focus, mat])
  useEffect(() => () => { geo.dispose(); mat.dispose() }, [geo, mat])
  return <mesh geometry={geo} material={mat} receiveShadow />
}

/** The table itself: a steel frame with a lip, legs out of view, and an engraved plate. */
function Frame() {
  const plate = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 64
    const g = c.getContext('2d')!
    g.fillStyle = '#1b1d20'; g.fillRect(0, 0, 1024, 64)
    g.fillStyle = '#a9a294'; g.font = '600 30px "Rajdhani", "Arial Narrow", sans-serif'; g.textBaseline = 'middle'
    g.fillText('FRONTIER THEATRE · SCHEMATIC RELIEF · POSITIONS ARE SLOTS, NOT SURVEY DATA', 24, 34)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
    return t
  }, [])
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.45, metalness: 0.8 }), [])
  return (
    <group>
      <mesh position={[0, -0.32, 0]} material={steel} receiveShadow><boxGeometry args={[W + 0.6, 0.5, D + 0.6]} /></mesh>
      {[[0, D / 2 + 0.15, W + 0.6, 0.3], [0, -D / 2 - 0.15, W + 0.6, 0.3], [W / 2 + 0.15, 0, 0.3, D], [-W / 2 - 0.15, 0, 0.3, D]].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.2, z]} material={steel} castShadow><boxGeometry args={[w, 0.5, d]} /></mesh>
      ))}
      <mesh position={[0, 0.2, D / 2 + 0.31]}><planeGeometry args={[W * 0.7, W * 0.7 / 16]} /><meshStandardMaterial map={plate} roughness={0.6} metalness={0.4} /></mesh>
    </group>
  )
}

// ── Miniatures ──────────────────────────────────────────────────────────────

function useMiniMats(owner: string) {
  return useMemo(() => {
    const m = (color: string, roughness = 0.8, metalness = 0.1) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
    const accent = factionPaint(owner)
    return {
      base: m('#3a3c3f', 0.9), wall: m('#8d877a'), roof: m('#5c5a55', 0.7, 0.3), dark: m('#24262a'), steel: m('#7a7f86', 0.5, 0.6),
      tank: m('#b4ad9e', 0.6, 0.3), accent: m(accent, 0.6), red: m('#7a2f22'), blue: m('#2f4a63'), olive: m('#5b5e3a'), tarp: m('#8a6a3a', 0.95),
      white: m('#d8d8d2', 0.5), glow: new THREE.MeshBasicMaterial({ color: '#ffb35c' }),
    }
  }, [owner])
}

function Mini({ f }: { f: TableFacility }) {
  const M = useMiniMats(f.owner)
  const box = (p: [number, number, number], s: [number, number, number], mat: THREE.Material, k?: string | number) => <mesh key={k} position={p} material={mat} castShadow receiveShadow><boxGeometry args={s} /></mesh>
  const cyl = (p: [number, number, number], r: number, h: number, mat: THREE.Material, k?: string | number, seg = 14) => <mesh key={k} position={p} material={mat} castShadow><cylinderGeometry args={[r, r, h, seg]} /></mesh>
  switch (f.id) {
    case 'dustline-depot':
      return (
        <group>
          {box([0, 0.03, 0], [2.2, 0.06, 1.8], M.base)}
          {box([-0.45, 0.3, -0.3], [1.0, 0.5, 0.7], M.wall)}
          <mesh position={[-0.45, 0.62, -0.3]} rotation={[0, 0, Math.PI / 4]} material={M.roof} castShadow><boxGeometry args={[0.38, 0.38, 0.72]} /></mesh>
          {[[0.5, -0.45, M.red], [0.5, -0.2, M.blue], [0.82, -0.45, M.olive], [0.5, -0.32, M.red]].map(([x, z, m], i) => box([x as number, i === 3 ? 0.27 : 0.1, z as number], [0.3, 0.13, 0.12], m as THREE.Material, i))}
          {[[-0.7, 0.55], [0.75, 0.5]].map(([x, z], i) => <group key={i} position={[x, 0, z]}>{box([0, 0.08, 0], [0.16, 0.12, 0.36], M.olive)}{box([0, 0.15, -0.12], [0.16, 0.1, 0.12], M.dark)}</group>)}
          <group position={[0.85, 0, 0.3]}>{[[-0.07, -0.07], [0.07, -0.07], [-0.07, 0.07], [0.07, 0.07]].map(([x, z], i) => box([x, 0.25, z], [0.025, 0.5, 0.025], M.steel, i))}{box([0, 0.55, 0], [0.24, 0.12, 0.24], M.wall)}</group>
          {box([-0.45, 0.42, 0.06], [0.6, 0.08, 0.01], M.accent)}
        </group>
      )
    case 'blacksite':
      return (
        <group>
          {box([0, 0.03, 0], [2.0, 0.06, 1.9], M.base)}
          {[[0, -0.85, 1.8, 0.06], [0, 0.85, 1.8, 0.06], [-0.9, 0, 0.06, 1.7], [0.9, 0, 0.06, 1.7]].map(([x, z, w, d], i) => box([x, 0.12, z], [w, 0.18, d], M.dark, i))}
          {box([-0.1, 0.25, -0.2], [1.1, 0.42, 0.9], M.wall)}
          {box([-0.1, 0.48, -0.2], [1.12, 0.04, 0.92], M.dark)}
          <mesh position={[0.55, 0.62, 0.45]} material={M.white} castShadow><sphereGeometry args={[0.2, 18, 12]} /></mesh>
          {cyl([0.55, 0.28, 0.45], 0.05, 0.5, M.steel)}
          <group position={[-0.75, 0, 0.7]}>{box([0, 0.3, 0], [0.04, 0.6, 0.04], M.steel)}{box([0, 0.62, 0], [0.2, 0.1, 0.2], M.dark)}</group>
          {box([-0.1, 0.3, 0.255], [0.4, 0.2, 0.01], M.accent)}
        </group>
      )
    case 'cinder-yard':
      return (
        <group>
          {box([0, 0.03, 0], [2.2, 0.06, 1.9], M.base)}
          {[[-0.6, -0.4], [-0.6, 0.15], [0.15, -0.4], [0.15, 0.15]].map(([x, z], i) => <group key={i}>{cyl([x, 0.2, z], 0.2, 0.34, M.tank, `t${i}`, 18)}{cyl([x, 0.33, z], 0.205, 0.04, M.red, `b${i}`, 18)}</group>)}
          {cyl([0.7, 0.45, -0.3], 0.07, 0.85, M.steel, 'c1')}{cyl([0.85, 0.4, -0.05], 0.06, 0.75, M.steel, 'c2')}
          {cyl([0.75, 0.6, 0.55], 0.04, 1.15, M.dark, 'stack')}
          <mesh position={[0.75, 1.22, 0.55]} material={M.glow}><coneGeometry args={[0.05, 0.14, 8]} /></mesh>
          <pointLight position={[0.75, 1.3, 0.55]} color="#ff8a3a" intensity={0.6} distance={2.5} decay={2} />
          {box([-0.2, 0.15, 0.65], [0.9, 0.18, 0.06], M.dark)}
          {box([-0.2, 0.2, 0.69], [0.3, 0.12, 0.01], M.accent)}
        </group>
      )
    default:
      if (f.owner === 'vex') {
        return (
          <group>
            {box([0, 0.03, 0], [1.6, 0.06, 1.3], M.base)}
            {[[-0.4, -0.2], [0.1, -0.25], [0.45, 0.2], [-0.3, 0.3]].map(([x, z], i) => (
              <group key={i} position={[x, 0, z]}>
                <mesh position={[0, 0.2, 0]} material={M.tarp} castShadow><coneGeometry args={[0.28, 0.3, 4]} /></mesh>
                {box([0, 0.07, 0], [0.34, 0.1, 0.34], M.dark)}
              </group>
            ))}
            {box([0.1, 0.1, 0.05], [0.18, 0.14, 0.14], M.red)}{box([0.32, 0.08, -0.05], [0.14, 0.1, 0.14], M.olive)}
            {box([-0.55, 0.25, 0.55], [0.4, 0.16, 0.02], M.accent)}
          </group>
        )
      }
      return (
        <group>
          {box([0, 0.03, 0], [1.7, 0.06, 1.3], M.base)}
          {box([0, 0.24, -0.15], [1.3, 0.4, 0.6], M.white)}
          {box([0, 0.4, 0.155], [1.3, 0.05, 0.01], M.accent)}
          {[-0.45, -0.15, 0.15, 0.45].map((x, i) => box([x, 0.08, 0.38], [0.2, 0.1, 0.2], M.tank, i))}
          {box([0.55, 0.1, 0.38], [0.2, 0.14, 0.2], M.steel)}
        </group>
      )
  }
}

/** A readiness ring on the ground, in the tone's colour; critical ones breathe. */
function Ring({ tone, selected, reduce }: { tone: Tone; selected: boolean; reduce: boolean }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: TONE_HEX[tone], transparent: true, opacity: 0.9, depthWrite: false }), [tone])
  const ref = useRef<THREE.Mesh>(null)
  useFrame((st) => {
    if (!ref.current) return
    const k = reduce || tone !== 'critical' ? 1 : 1 + 0.06 * Math.sin(st.clock.elapsedTime * 3)
    ref.current.scale.setScalar(k)
    mat.opacity = selected ? 1 : 0.75
  })
  useEffect(() => () => mat.dispose(), [mat])
  return <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]} material={mat}><ringGeometry args={[2.35, selected ? 2.55 : 2.45, 56]} /></mesh>
}

/** The owner's real stock beside a selected facility: six slots per resource. */
function StockStacks({ supply }: { supply: FacilitySupply[] }) {
  const mats = useMemo(() => Object.fromEntries((['ammo', 'med', 'fuel'] as const).map((r) => [r, new THREE.MeshStandardMaterial({ color: RES_HEX[r], roughness: 0.7, metalness: 0.15 })])) as Record<ResourceName, THREE.MeshStandardMaterial>, [])
  const empty = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.9, transparent: true, opacity: 0.55 }), [])
  return (
    <group position={[2.9, 0, -1.1]} scale={1.8}>
      {supply.map((s, row) => {
        const { filled, slots } = supplySlots(s.stock, s.target)
        return Array.from({ length: slots }, (_, i) => {
          const on = i < filled
          const p: [number, number, number] = [(i % 3) * 0.17, 0.08 + Math.floor(i / 3) * 0.15, row * 0.5]
          return s.resource === 'fuel'
            ? <mesh key={`${row}-${i}`} position={p} material={on ? mats.fuel : empty} castShadow><cylinderGeometry args={[0.065, 0.065, 0.14, 12]} /></mesh>
            : <mesh key={`${row}-${i}`} position={p} material={on ? mats[s.resource] : empty} castShadow><boxGeometry args={[0.15, 0.12, 0.12]} /></mesh>
        })
      })}
    </group>
  )
}

function Facility({ f, status, selected, onSelect, supply, reduce }: { f: TableFacility; status: FacilityStatus | undefined; selected: boolean; onSelect: (id: string) => void; supply: FacilitySupply[] | undefined; reduce: boolean }) {
  const [x, z] = toTable(f.pos)
  const [hover, setHover] = useState(false)
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(f.id) }
  useEffect(() => { document.body.style.cursor = hover ? 'pointer' : ''; return () => { document.body.style.cursor = '' } }, [hover])
  const tone = status?.tone ?? 'info'
  return (
    <group position={[x, 0.18, z]} onClick={click} onPointerOver={(e) => { e.stopPropagation(); setHover(true) }} onPointerOut={() => setHover(false)} data-testid={`mini-${f.id}`}>
      <group scale={(hover && !selected ? 1.06 : 1) * 1.7}><Mini f={f} /></group>
      <Ring tone={tone} selected={selected} reduce={reduce} />
      {selected && supply && <StockStacks supply={supply} />}
      {selected && supply && (
        <Html position={[3.6, -0.1, 1.2]} center style={{ pointerEvents: 'none' }}>
          <div aria-hidden className="whitespace-nowrap text-[11px] uppercase tracking-widest text-muted" style={{ textShadow: '0 1px 2px #000' }}>{f.kind === 'site' ? 'Holder\'s stock' : 'Shelf'} · ammo · med · fuel</div>
        </Html>
      )}
      {/* Labels are interface, not scenery: crisp DOM text that follows the miniature. The
          list under the map is the accessible control, so these are hidden from screen readers. */}
      <Html position={[0, 2.3, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div aria-hidden className="whitespace-nowrap text-center" style={{ textShadow: '0 1px 2px #000, 0 0 8px #000' }}>
          <div className={`font-display text-[13px] font-bold uppercase tracking-wider ${selected ? 'text-amber-hi' : 'text-fog'}`}>{f.name}</div>
          {status && <div className="font-display text-[11px] font-semibold uppercase tracking-widest" style={{ color: TONE_HEX[tone] }}>{status.label}</div>}
          <div className="mt-0.5 flex justify-center gap-1">
            {status && status.openContracts > 0 && <span className="bg-amber px-1.5 text-[11px] font-bold text-ink">{status.openContracts} contract{status.openContracts === 1 ? '' : 's'}</span>}
            {status && status.linesDown > 0 && <span className="bg-hostile px-1.5 text-[11px] font-bold text-ink">line down</span>}
            {status && status.activeOperations > 0 && <span className="bg-steel px-1.5 text-[11px] font-bold text-ink">operator in</span>}
          </div>
        </div>
      </Html>
      {status && status.linesDown > 0 && <Beacon reduce={reduce} />}
    </group>
  )
}

/** A red hazard beacon over a site whose production line is down. */
function Beacon({ reduce }: { reduce: boolean }) {
  const ref = useRef<THREE.MeshBasicMaterial>(null)
  useFrame((st) => { if (ref.current) ref.current.opacity = reduce ? 0.9 : 0.45 + 0.55 * Math.max(0, Math.sin(st.clock.elapsedTime * 4)) })
  return <mesh position={[-1.7, 1.3, -1.0]}><sphereGeometry args={[0.16, 12, 8]} /><meshBasicMaterial ref={ref} color="#ff3b30" transparent /></mesh>
}

// ── Convoys ─────────────────────────────────────────────────────────────────

/** A convoy on the road, placed at the server's progress; the route shows only while one is on it. */
function Convoy({ c, roadY }: { c: TableConvoy; roadY: number }) {
  const pts = useMemo(() => c.path.map((p) => { const [x, z] = toTable(p); return new THREE.Vector3(x, roadY, z) }), [c.path, roadY])
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: RES_HEX[c.resource], dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.8 }))
    l.computeLineDistances()
    return l
  }, [pts, c.resource])
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose() }, [line])
  // A seized convoy sits with whoever took it: park it just in front of their miniature, clear of its labels.
  const [x, z0] = toTable(c.pos)
  const z = c.state === 'seized' ? z0 + 2.9 : z0
  // face along the road segment the marker is on
  const seg = c.path.findIndex((p, i) => i > 0 && Math.hypot(p.x - c.pos.x, p.y - c.pos.y) > 0.5 && ((p.x - c.path[i - 1].x) * (c.pos.x - c.path[i - 1].x) + (p.y - c.path[i - 1].y) * (c.pos.y - c.path[i - 1].y)) >= 0)
  const a = seg > 0 ? c.path[seg - 1] : c.path[0], b = seg > 0 ? c.path[seg] : c.path[1] ?? c.path[0]
  const yaw = Math.atan2(-(b.y - a.y), b.x - a.x)
  const seized = c.state === 'seized'
  return (
    <group>
      {c.state === 'in_transit' && <primitive object={line} />}
      <group position={[x, roadY, z]} rotation={[0, yaw, 0]} scale={1.8}>
        <mesh position={[0.05, 0.08, 0]} castShadow><boxGeometry args={[0.34, 0.14, 0.16]} /><meshStandardMaterial color={seized ? '#e5484d' : '#5b5e3a'} roughness={0.8} /></mesh>
        <mesh position={[-0.17, 0.09, 0]} castShadow><boxGeometry args={[0.12, 0.16, 0.16]} /><meshStandardMaterial color="#2a2c30" /></mesh>
        <mesh position={[0.05, 0.17, 0]}><boxGeometry args={[0.3, 0.03, 0.17]} /><meshBasicMaterial color={RES_HEX[c.resource]} /></mesh>
      </group>
      <Html position={[x, roadY + 0.6, z]} center style={{ pointerEvents: 'none' }}>
        <div aria-hidden className="whitespace-nowrap font-display text-[11px] font-semibold" style={{ color: seized ? '#e5484d' : RES_HEX[c.resource], textShadow: '0 1px 2px #000' }}>
          {c.units} {c.resource}{seized ? ` · seized` : ` · ${Math.round(c.progress * 100)}%`}
        </div>
      </Html>
    </group>
  )
}

// ── Camera ──────────────────────────────────────────────────────────────────

const HOME = { pos: new THREE.Vector3(0, 23, 21), look: new THREE.Vector3(0, 0, 1.2) }

/** Glides to the selected facility (snaps under Reduce motion); a slow drift otherwise. */
function Rig({ focus, reduce }: { focus: [number, number] | null; reduce: boolean }) {
  const { camera, size } = useThree()
  const look = useRef(HOME.look.clone())
  const narrow = size.width < 640
  useFrame((st, dt) => {
    const back = narrow ? 1.3 : 1
    const goalLook = focus ? new THREE.Vector3(focus[0] * 0.8, 0, focus[1] * 0.8 + 0.6) : HOME.look
    const goalPos = focus
      ? new THREE.Vector3(focus[0] * 0.8, 13 * back, focus[1] * 0.8 + 12.5 * back)
      : HOME.pos.clone().multiplyScalar(back)
    if (!reduce) goalPos.x += Math.sin(st.clock.elapsedTime * 0.08) * 0.6
    const k = reduce ? 1 : 1 - Math.exp(-dt * 2.2)
    camera.position.lerp(goalPos, k)
    look.current.lerp(goalLook, k)
    camera.lookAt(look.current)
  })
  return null
}

export default function WarTable3D({ model, status, selectedId, focusId, onSelect, tick, supply, reduce }: {
  model: TableModel; status: Record<string, FacilityStatus>; selectedId: string | null
  /** The facility the player picked: the camera only moves for a real choice. */
  focusId: string | null
  onSelect: (id: string) => void; tick: number
  /** The selected facility's owner's stock against target, by resource. */
  supply: FacilitySupply[] | undefined
  reduce: boolean
}) {
  const visible = usePageVisible()
  const picked = model.facilities.find((f) => f.id === focusId)
  const focus = picked ? toTable(picked.pos) : null
  const roadY = 0.2
  return (
    <div className="relative aspect-[4/3] w-full min-h-[260px] sm:aspect-[16/10] overflow-hidden bg-[#0b0c0f]" data-testid="war-table-3d"
      role="img" aria-label={`War Table, a schematic relief of the frontier. ${model.facilities.map((f) => `${f.name}: ${status[f.id]?.label ?? 'no reading'}`).join('. ')}. ${model.convoys.filter((c) => c.state === 'in_transit').length} convoys on the road.`}>
      <Canvas
        frameloop={visible ? 'always' : 'never'}
        dpr={[1, 1.75]}
        shadows
        camera={{ fov: 38, position: HOME.pos.toArray(), near: 0.1, far: 100 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
        onCreated={({ scene }) => { scene.background = new THREE.Color('#0b0c0f'); scene.fog = new THREE.Fog('#0b0c0f', 26, 48) }}
        onPointerMissed={() => undefined}
      >
        <hemisphereLight args={['#9fb2c4', '#2a1f16', 0.55]} />
        <directionalLight position={[-6, 14, 8]} intensity={2.4} color="#ffe2bd" castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-bias={-0.0006} />
        <spotLight position={[0, 12, 2]} angle={0.9} penumbra={0.9} intensity={40} distance={30} color="#ffc98a" />
        <Frame />
        <Relief model={model} focus={focus} />
        {model.facilities.map((f) => (
          <Facility key={f.id} f={f} status={status[f.id]} selected={f.id === selectedId} onSelect={onSelect} supply={f.id === selectedId ? supply : undefined} reduce={reduce} />
        ))}
        {model.convoys.filter((c) => c.state === 'in_transit' || c.state === 'seized').map((c) => <Convoy key={c.id} c={c} roadY={roadY} />)}
        <OffMap at={toTable(model.offMap)} />
        <Rig focus={focus} reduce={reduce} />
      </Canvas>
      <div className="pointer-events-none absolute left-2 top-2 text-[11px] text-dim">Schematic relief · Day {Math.floor(tick / 24)}, {String(tick % 24).padStart(2, '0')}:00</div>
    </div>
  )
}

/** Where supply enters the table: an arrow at the edge, labelled. */
function OffMap({ at }: { at: [number, number] }) {
  const [x, z] = at
  return (
    <group position={[x + 0.6, 0.22, z]}>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]}><coneGeometry args={[0.25, 0.5, 3]} /><meshBasicMaterial color="#8d929a" /></mesh>
      <Html position={[0, 0.6, 0]} center style={{ pointerEvents: 'none' }}>
        <div aria-hidden className="whitespace-nowrap text-[10px] uppercase tracking-widest text-muted" style={{ textShadow: '0 1px 2px #000' }}>Off-map supply</div>
      </Html>
    </group>
  )
}
