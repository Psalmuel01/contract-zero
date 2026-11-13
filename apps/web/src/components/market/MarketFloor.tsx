'use client'

// The Exchange's centrepiece: the two merchants side by side on a supply-depot floor.
// Vex Exchange trades off a tarp-covered counter under hanging bulbs; Halcyon Logistics
// runs a clean white depot with racked, palletised freight. Their shelves are the real
// shelves (six slots per resource, filled by stock over target, so 5 and 5,000 draw
// alike), their price boards show the live ask and bid, and each says how it is
// trading from the same presenter as the rest of the game. Nothing here is decoration
// standing in for data: an empty shelf is an empty shelf.

import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import type { MarketMerchant, ResourceName } from '@/lib/api'
import { supplySlots } from '@/lib/world/table'
import { describeMerchant, MERCHANT_LABEL } from '@/lib/presenter/merchant'
import { usePageVisible } from '@/lib/usePageVisible'
import { FactionInsignia } from '@/components/ui/FactionInsignia'

const RES: ResourceName[] = ['ammo', 'med', 'fuel']
const RES_HEX: Record<ResourceName, string> = { ammo: '#c98a2e', med: '#3f9a63', fuel: '#4f7fa3' }
const STATE_CLASS: Record<string, string> = { trading: 'text-friendly', stretched: 'text-amber-hi', constrained: 'text-hostile', insolvent: 'text-hostile' }

function Shelf({ m, x, clean }: { m: MarketMerchant; x: number; clean: boolean }) {
  const mats = useMemo(() => ({
    full: Object.fromEntries(RES.map((r) => [r, new THREE.MeshStandardMaterial({ color: RES_HEX[r], roughness: 0.75, metalness: r === 'fuel' ? 0.5 : 0.1 })])) as Record<ResourceName, THREE.MeshStandardMaterial>,
    empty: new THREE.MeshStandardMaterial({ color: '#25272b', roughness: 0.95, transparent: true, opacity: 0.35 }),
    rack: new THREE.MeshStandardMaterial({ color: clean ? '#c9ccd0' : '#5a4630', roughness: clean ? 0.4 : 0.9, metalness: clean ? 0.6 : 0.05 }),
  }), [clean])
  return (
    <group position={[x, 0.95, -1.15]}>
      {/* the rack: three levels, one per resource */}
      {[0, 1, 2].map((lv) => <mesh key={lv} position={[0, 0.05 + lv * 0.62, 0]} material={mats.rack} receiveShadow castShadow><boxGeometry args={[2.6, 0.06, 0.7]} /></mesh>)}
      {[-1.28, 1.28].map((px) => <mesh key={px} position={[px, 0.3, 0]} material={mats.rack}><boxGeometry args={[0.06, 2.4, 0.7]} /></mesh>)}
      {RES.map((r, lv) => {
        const s = supplySlots(m.shelves[r].stock, m.shelves[r].target)
        return Array.from({ length: s.slots }, (_, i) => {
          const on = i < s.filled
          const p: [number, number, number] = [-1.0 + i * 0.4, 0.27 + lv * 0.62, 0]
          return r === 'fuel'
            ? <mesh key={`${r}${i}`} position={[p[0], p[1] + 0.02, p[2]]} material={on ? mats.full.fuel : mats.empty} castShadow><cylinderGeometry args={[0.15, 0.15, 0.4, 14]} /></mesh>
            : <mesh key={`${r}${i}`} position={p} material={on ? mats.full[r] : mats.empty} castShadow><boxGeometry args={[0.34, 0.36, 0.42]} /></mesh>
        })
      })}
    </group>
  )
}

/** A bulb on a flex that sways a little (still under Reduce motion). */
function Bulb({ x, z, reduce }: { x: number; z: number; reduce: boolean }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((st) => { if (ref.current && !reduce) ref.current.rotation.z = Math.sin(st.clock.elapsedTime * 0.9 + x) * 0.05 })
  return (
    <group ref={ref} position={[x, 4.0, z]}>
      <mesh position={[0, -0.4, 0]}><cylinderGeometry args={[0.008, 0.008, 0.8, 4]} /><meshBasicMaterial color="#111" /></mesh>
      <mesh position={[0, -0.82, 0]}><sphereGeometry args={[0.07, 10, 8]} /><meshBasicMaterial color="#ffd08a" /></mesh>
      <pointLight position={[0, -0.85, 0]} color="#ffb860" intensity={1.6} distance={4.5} decay={1.6} />
    </group>
  )
}

function VexStall({ m, reduce }: { m: MarketMerchant; reduce: boolean }) {
  const tarp = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4e3b22', roughness: 1, side: THREE.DoubleSide }), [])
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5f4a32', roughness: 0.95 }), [])
  return (
    <group position={[-2.6, 0, 0]}>
      <mesh position={[0, 0.4, 0.55]} material={wood} castShadow receiveShadow><boxGeometry args={[3.0, 0.8, 0.6]} /></mesh>
      <mesh position={[0, 3.85, -0.5]} rotation={[0.3, 0, 0]} material={tarp} castShadow><planeGeometry args={[3.6, 2.4]} /></mesh>
      {[-1.6, 1.6].map((px) => <mesh key={px} position={[px, 1.85, 0.75]} material={wood}><boxGeometry args={[0.1, 3.7, 0.1]} /></mesh>)}
      <Shelf m={m} x={0} clean={false} />
      {[-1.0, 0, 1.0].map((bx) => <Bulb key={bx} x={bx} z={0.4} reduce={reduce} />)}
      {/* chalked crates by the counter */}
      <mesh position={[1.9, 0.25, 0.9]} rotation={[0, 0.3, 0]} material={wood} castShadow><boxGeometry args={[0.6, 0.5, 0.5]} /></mesh>
      <mesh position={[1.75, 0.7, 0.85]} rotation={[0, -0.2, 0]} material={wood} castShadow><boxGeometry args={[0.5, 0.4, 0.45]} /></mesh>
    </group>
  )
}

function HalcyonDepot({ m }: { m: MarketMerchant }) {
  const white = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d8dadc', roughness: 0.45, metalness: 0.2 }), [])
  const blue = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7fb6e6' }), [])
  return (
    <group position={[2.6, 0, 0]}>
      <mesh position={[0, 0.4, 0.55]} material={white} castShadow receiveShadow><boxGeometry args={[3.0, 0.8, 0.6]} /></mesh>
      <mesh position={[0, 0.78, 0.86]} material={blue}><boxGeometry args={[3.0, 0.03, 0.01]} /></mesh>
      <mesh position={[0, 3.45, -0.6]} material={white} castShadow><boxGeometry args={[3.4, 0.12, 2.2]} /></mesh>
      <mesh position={[0, 3.37, 0.5]} material={blue}><boxGeometry args={[3.2, 0.03, 0.03]} /></mesh>
      <Shelf m={m} x={0} clean />
      {/* palletised freight, squared away */}
      {[-0.5, 0.15].map((px) => <mesh key={px} position={[2.0 + px * 0.2, 0.06, 0.9 + px]} material={white}><boxGeometry args={[0.8, 0.12, 0.8]} /></mesh>)}
      <pointLight position={[0, 3.1, 0.8]} intensity={4} distance={6} decay={1.5} color="#dfeaff" />
    </group>
  )
}

function Board({ m, x }: { m: MarketMerchant; x: number }) {
  const p = describeMerchant(m)
  return (
    <Html position={[x, 4.35, -0.4]} center style={{ pointerEvents: 'none' }}>
      <div aria-hidden className="whitespace-nowrap text-center" style={{ textShadow: '0 1px 2px #000, 0 0 8px #000' }}>
        <div className="flex items-center justify-center gap-1.5 font-display text-[15px] font-bold uppercase tracking-wider text-fog"><FactionInsignia id={m.id} className="h-4 w-4" />{m.name}</div>
        <div className={`font-display text-[11px] font-semibold uppercase tracking-widest ${STATE_CLASS[p.state] ?? 'text-muted'}`}>{MERCHANT_LABEL[p.state]}</div>
        <div className="mt-1 hidden gap-x-4 font-mono text-[11px] sm:flex sm:justify-center">
          {RES.map((r) => <span key={r} className="text-muted">{r} <span className="text-fog">{m.shelves[r].ask ?? '—'}</span> · <span className="text-amber-hi">{m.shelves[r].bid ?? '—'}</span></span>)}
        </div>
        <div className="hidden text-[10px] text-dim sm:block">sells · buys, credits a unit · {m.record.wins} orders won</div>
      </div>
    </Html>
  )
}

export default function MarketFloor({ merchants, reduce }: { merchants: MarketMerchant[]; reduce: boolean }) {
  const visible = usePageVisible()
  const vex = merchants.find((m) => m.id === 'vex'), hal = merchants.find((m) => m.id === 'halcyon')
  const floor = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b2824', roughness: 0.95 }), [])
  useEffect(() => () => floor.dispose(), [floor])
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#0d0d0f] sm:aspect-[21/8]" data-testid="market-floor"
      role="img" aria-label={`The market floor. ${merchants.map((m) => `${m.name}: ${MERCHANT_LABEL[describeMerchant(m).state]}; ${RES.map((r) => `${r} ${m.shelves[r].stock} on the shelf against ${m.shelves[r].target}, sells at ${m.shelves[r].ask ?? 'no price'}, buys at ${m.shelves[r].bid ?? 'no price'}`).join('; ')}`).join('. ')}`}>
      <Canvas frameloop={visible ? 'always' : 'never'} dpr={[1, 1.75]} shadows camera={{ fov: 34, position: [0, 3.4, 10.4], near: 0.1, far: 60 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        onCreated={({ scene, camera }) => { scene.background = new THREE.Color('#0d0d0f'); scene.fog = new THREE.Fog('#0d0d0f', 12, 26); camera.lookAt(0, 1.9, 0) }}>
        <hemisphereLight args={['#8fa2b4', '#2a2018', 0.45]} />
        <directionalLight position={[3, 8, 6]} intensity={1.1} color="#ffe2c0" castShadow shadow-mapSize={[1024, 1024]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={floor} receiveShadow><planeGeometry args={[30, 16]} /></mesh>
        {/* the depot's back wall, so the stalls stand somewhere */}
        <mesh position={[0, 3, -3]}><planeGeometry args={[30, 6]} /><meshStandardMaterial color="#1a1b1e" roughness={0.9} /></mesh>
        {vex && <VexStall m={vex} reduce={reduce} />}
        {hal && <HalcyonDepot m={hal} />}
        {vex && <Board m={vex} x={-2.6} />}
        {hal && <Board m={hal} x={2.6} />}
      </Canvas>
      <div className="pointer-events-none absolute bottom-1.5 left-2 text-[10px] text-dim">Shelves: six slots per resource, filled by stock over target. Amber ammunition, green medicine, blue fuel.</div>
    </div>
  )
}
