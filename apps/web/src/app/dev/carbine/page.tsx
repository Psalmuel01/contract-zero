'use client';

/** The service carbine as an object: the player's own first-person model (the same
 *  prototype, worn finish and all), in a dark studio, from fixed angles a capture
 *  can rely on. Dev only.  /dev/carbine?view=three-quarter|side|muzzle|top */

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { useGunPrototypes } from '@/engine/scene/gunModels';

const VIEWS: Record<string, { pos: [number, number, number]; fov: number }> = {
  // Barrel runs along +Z (the engine's weapon convention); +X is the gun's right side.
  'three-quarter': { pos: [0.95, 0.32, 0.62], fov: 36 },
  side: { pos: [1.35, 0.06, 0.0], fov: 38 },
  muzzle: { pos: [0.42, 0.1, 0.95], fov: 34 },
  top: { pos: [0.55, 1.1, 0.15], fov: 36 },
};

function Carbine() {
  const protos = useGunPrototypes();
  const gun = useMemo(() => {
    const g = protos.assault_rifle.clone(true);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }, [protos]);
  return <primitive object={gun} position={[0, 0.02, 0]} />;
}

function Studio() {
  const q = useSearchParams();
  const v = VIEWS[q.get('view') ?? 'three-quarter'] ?? VIEWS['three-quarter'];
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: v.pos, fov: v.fov }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05, preserveDrawingBuffer: true }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      <color attach="background" args={['#0c0d10']} />
      <fog attach="fog" args={['#0c0d10', 1.6, 3.2]} />
      <hemisphereLight args={['#aab6c4', '#15161a', 0.35]} />
      {/* Warm key, cool rim, a low fill: the light the game's dusk uses. */}
      <directionalLight position={[1.4, 2.2, 1.2]} intensity={2.6} color="#ffe2bf" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} />
      <directionalLight position={[-1.6, 0.9, -1.4]} intensity={1.7} color="#7fb2ff" />
      <pointLight position={[0.2, -0.3, 0.9]} intensity={0.35} color="#ffd9a8" />
      <Suspense fallback={null}>
        <Carbine />
        <Environment preset="warehouse" environmentIntensity={0.35} />
      </Suspense>
      <ContactShadows position={[0, -0.12, 0]} opacity={0.55} scale={2} blur={2.4} far={0.5} />
    </Canvas>
  );
}

export default function CarbineStudio() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0c0d10' }}>
      <Suspense fallback={null}><Studio /></Suspense>
    </div>
  );
}
