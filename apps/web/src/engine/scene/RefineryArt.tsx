'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { LevelDef } from '../fps/levels';
import { buildColumn, buildFlareStack, buildLoadingArm, buildRackDetail, buildTank, buildWallServices, mergeKit, type KitGeometry, type KitMaterial } from './refineryKit';

/**
 * The plant on a site, built from the level's own colliders by `refineryKit`: every
 * tank, column and pipe rack at its real size, with the detail a scaled cylinder never
 * had, merged to one mesh per material. The flat tiers (minimal) keep the instanced
 * primitives in LevelArt instead; this layer only mounts on the full ones.
 *
 * Which kit material each site material plays:
 *   tank → the level's tank paint · steel → galvanised steel · pipe → painted pipe
 *   concrete → plinths · hazard → yellow · rust → oxidised fittings · dark → grating
 */
const SHADOW: Record<KitMaterial, boolean> = { tank: true, steel: true, pipe: true, concrete: true, hazard: false, rust: true, dark: false };

/** The box corner a tank's stair tower faces: toward the road (x = 0) and the gate (+z). */
function stairCornerFor(x: number, z: number): number {
  const towardPlusX = x < 0, towardPlusZ = z > -2;
  return towardPlusX ? (towardPlusZ ? 0 : 3) : (towardPlusZ ? 1 : 2);
}

/** Where the Cinder Yard's tanker loading arm stands: in the small tank's corner, reaching the tanker's hatch. */
const CINDER_LOADING_ARM = { from: [14.4, -10.6] as [number, number], to: [10.8, 3.05, -11.5] as [number, number, number] };

export function buildSiteKit(level: LevelDef): KitGeometry[] {
  const parts: KitGeometry[] = [];
  const boxes = [...level.walls, ...level.cover];
  for (const b of boxes) {
    if (b.kind === 'tank') parts.push(buildTank({ x: b.x, z: b.z, size: b.w, height: b.h, stairCorner: stairCornerFor(b.x, b.z) }));
    else if (b.kind === 'column') parts.push(buildColumn({ x: b.x, z: b.z, size: b.w, height: b.h }));
    else if (b.kind === 'pipe_rack') parts.push(buildRackDetail({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h }));
  }
  if (level.id === 'cinder_yard') {
    for (const a of level.art) if (a.kind === 'stack') parts.push(buildFlareStack({ x: a.x, z: a.z, height: a.h ?? 22 }));
    parts.push(buildLoadingArm(CINDER_LOADING_ARM));
    // Services on the blast wall's two long segments (the faces the tank farm sees) and
    // the north wall (the face the processing deck sees).
    let seed = 1;
    for (const w of level.walls) {
      if (w.kind !== 'concrete' || w.w < 20) continue;
      parts.push(buildWallServices({ x: w.x, z: w.z, w: w.w, d: w.d, h: w.h, face: '+z' }, seed++));
    }
  }
  return parts;
}

export function RefineryArt({ level, mats }: { level: LevelDef; mats: Record<string, THREE.Material> }) {
  const merged = useMemo(() => mergeKit(buildSiteKit(level)), [level]);
  useEffect(() => () => { for (const g of Object.values(merged)) g?.dispose(); }, [merged]);
  const material = (m: KitMaterial) => (m === 'dark' ? mats.frame : mats[m]) ?? mats.steel;
  return (
    <group>
      {(Object.entries(merged) as [KitMaterial, THREE.BufferGeometry][]).map(([m, g]) => (
        <mesh key={m} geometry={g} material={material(m)} castShadow={SHADOW[m]} receiveShadow />
      ))}
    </group>
  );
}
