import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { LEVELS } from '../../fps/levels'
import { terrainHeight, buildTerrainApron } from '../terrainRelief'
import { reloadPose, safeWeaponDepth } from '../viewmodelPose'
import { makeSiteGround } from '../siteGround'

async function asset(file: string) {
  const b = readFileSync(resolve(process.cwd(), 'public/models/production', file))
  return new GLTFLoader().parseAsync(Uint8Array.from(b).buffer, '')
}

describe('production visual assets and gameplay boundaries', () => {
  it('loads a compact original carbine with a detachable magazine and valid PBR surfaces', async () => {
    const { scene } = await asset('service-carbine.glb')
    expect(scene.getObjectByName('magazine')).toBeTruthy()
    const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3())
    expect(size.z).toBeGreaterThan(.85);expect(size.z).toBeLessThan(.90)
    scene.traverse((o) => { if (o instanceof THREE.Mesh) expect(o.material).toBeInstanceOf(THREE.MeshStandardMaterial) })
    expect(readFileSync(resolve(process.cwd(),'public/models/production/service-carbine.glb')).length).toBeLessThan(400_000)
  })
  it('keeps every environment module within its unit collision envelope', async () => {
    const { scene } = await asset('modular-kit.glb')
    for (const name of ['container','barrier','case','truck','pump']) {
      const part = scene.getObjectByName(name)!
      expect(part).toBeTruthy()
      const b = new THREE.Box3().setFromObject(part)
      for (const axis of ['x','y','z'] as const) {expect(b.min[axis]).toBeGreaterThanOrEqual(-.501);expect(b.max[axis]).toBeLessThanOrEqual(.501)}
    }
  })
  it('never raises terrain inside a playable site, nor before the perimeter wall 15 m out (it buried its base)', () => {
    for (const level of Object.values(LEVELS)) {
      const b=level.bounds
      for(let x=b.minX-18;x<=b.maxX+18;x+=2)for(let z=b.minZ-18;z<=b.maxZ+18;z+=2) {
        if (Math.hypot(Math.max(b.minX-x,0,x-b.maxX), Math.max(b.minZ-z,0,z-b.maxZ)) > 18) continue
        expect(terrainHeight(level,x,z)).toBeCloseTo(-.065)
      }
      const high=buildTerrainApron(level),low=buildTerrainApron(level,true)
      expect(low.attributes.position.count).toBeLessThan(high.attributes.position.count)
      for(const g of [high,low]) {expect(g.boundingSphere?.radius).toBeGreaterThan(0);expect([...g.attributes.normal.array].every(Number.isFinite)).toBe(true);g.dispose()}
    }
  })
  it('keeps stocks ahead of the eye during recoil and returns reload parts to rest', () => {
    for (const len of [.26,.52,.88,1.16]) {
      expect(safeWeaponDepth(.1,len)+len*.15).toBeLessThanOrEqual(-.099) // at the hip the stock may pass the eye, the grip may not
      expect(safeWeaponDepth(.1,len,1,1)+len/2).toBeLessThanOrEqual(-.099) // aimed, the whole weapon stays ahead
    }
    for(const p of [0,1]) expect(reloadPose(p,true,false).magazineDrop).toBe(0)
    expect(reloadPose(.5,true,false).magazineDrop).toBeGreaterThan(.1)
    expect(reloadPose(.5,true,true).dip).toBe(0)
    expect(reloadPose(.5,false,false).roll).toBe(0)
  })
  it('compiles surface blending out of Low and preserves the standard lighting chunks', () => {
    const maps={map:new THREE.Texture(),normalMap:new THREE.Texture(),roughnessMap:new THREE.Texture()}
    const high=makeSiteGround(maps,maps,'blacksite','#ffffff',false), low=makeSiteGround(maps,maps,'blacksite','#ffffff',true)
    const run=(m: THREE.MeshStandardMaterial)=>{
      const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader}
      m.onBeforeCompile(s as unknown as THREE.WebGLProgramParametersWithUniforms,null as never);return s.fragmentShader
    }
    expect(run(high)).toContain('groundPatch')
    expect(run(high)).toContain('#include <lights_fragment_begin>')
    expect(run(low)).not.toContain('groundPatch')
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader}
    high.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms,null as never)
    expect(shader.vertexShader).toContain('instanceMatrix * vec4( transformed, 1.0 )')
    expect(shader.vertexShader).toContain('triLocalNormal /= vec3(')
    high.dispose();low.dispose()
  })
})
