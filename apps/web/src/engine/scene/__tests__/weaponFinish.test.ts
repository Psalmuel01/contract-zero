import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { applyWeaponFinish, finishWeapon } from '../weaponFinish'
import { ShellCasings } from '../../vfx/ShellCasings'

function compile(m: THREE.MeshStandardMaterial) {
  const s = { uniforms: {} as Record<string, unknown>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader }
  m.onBeforeCompile(s as unknown as THREE.WebGLProgramParametersWithUniforms, null as never)
  return s
}

describe('the weapon finish', () => {
  it('patches the standard shader without losing its lighting, and reads the wear mask itself', () => {
    const m = applyWeaponFinish(new THREE.MeshStandardMaterial({ color: '#2a2d30', metalness: 0.5, roughness: 0.5 }))
    const s = compile(m)
    expect(m.vertexColors).toBe(false) // the mask is a mask, not a tint
    expect(s.vertexShader).toContain('vFinMask = color.rg')
    expect(s.fragmentShader).toContain('#include <lights_fragment_begin>')
    expect(s.fragmentShader).toContain('uWearColor')
    expect(s.fragmentShader).toContain('roughnessFactor = mix(roughnessFactor, uWearRough, finWear)')
    expect(Object.keys(s.uniforms)).toEqual(expect.arrayContaining(['uWearColor', 'uWearAmt', 'uGrime', 'uGrain', 'uScratch']))
    expect(m.customProgramCacheKey()).toContain('weaponFinish')
  })
  it('finishes the carbine once per material and leaves its glass and emitter alone', async () => {
    const b = readFileSync(resolve(process.cwd(), 'public/models/production/service-carbine.glb'))
    const { scene } = await new GLTFLoader().parseAsync(Uint8Array.from(b).buffer, '')
    const before = new Set<THREE.Material>()
    scene.traverse((o) => { if (o instanceof THREE.Mesh) before.add(o.material as THREE.Material) })
    finishWeapon(scene)
    const after = new Map<string, THREE.Material>()
    scene.traverse((o) => { if (o instanceof THREE.Mesh) after.set(o.material.name || o.name, o.material as THREE.Material) })
    // Every opaque authored material was replaced by a finished clone; glass and the reticle were not.
    for (const m of before) {
      const std = m as THREE.MeshStandardMaterial
      const kept = [...after.values()].includes(m)
      if (std.transparent || std.name === 'reticle') expect(kept).toBe(true)
      else expect(kept).toBe(false)
    }
    // One clone per source material: five bodies, not one per mesh.
    const finished = [...new Set(after.values())].filter((m) => m.customProgramCacheKey().includes('weaponFinish'))
    expect(finished.length).toBeGreaterThanOrEqual(4)
    expect(finished.length).toBeLessThanOrEqual(6)
    // The GLB carries the baked wear mask the finish reads.
    const mesh = scene.getObjectByName('alloy') as THREE.Mesh
    expect(mesh.geometry.getAttribute('color')).toBeTruthy()
    expect(scene.getObjectByName('optic')).toBeTruthy()
    expect(scene.getObjectByName('reticle')).toBeTruthy()
  })
})

describe('shell casings', () => {
  it('throws brass right and up, drops it under gravity and lets it settle on the floor', () => {
    const c = new ShellCasings()
    const at = new THREE.Vector3(0, 1.5, 0)
    c.eject(at, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1))
    const m = new THREE.Matrix4(), p = new THREE.Vector3()
    c.update(0.05)
    c.mesh.getMatrixAt(0, m); p.setFromMatrixPosition(m)
    expect(p.x).toBeGreaterThan(0.05) // to the right
    expect(p.y).toBeGreaterThan(1.5)  // and up, at first
    for (let i = 0; i < 40; i++) c.update(0.05)
    c.mesh.getMatrixAt(0, m); p.setFromMatrixPosition(m)
    expect(p.y).toBeLessThan(0.05)    // on the floor
    expect(p.y).toBeGreaterThan(0)    // not through it
    for (let i = 0; i < 20; i++) c.update(0.05)
    c.mesh.getMatrixAt(0, m)
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBe(0) // recycled: scaled away
    c.dispose()
  })
})
