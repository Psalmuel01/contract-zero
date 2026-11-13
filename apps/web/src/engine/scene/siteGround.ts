import { makeTriplanarMaterial } from './triplanar'
import type { PbrMaps } from './usePbr'
import type { LevelId } from '../fps/levels'

/** Reuses the already-shipped concrete and earth maps: no new texture allocations.
 * Low retains one surface sample. Other tiers blend weathered patches in world metres. */
export function makeSiteGround(earth: PbrMaps, concrete: PbrMaps, site: LevelId | undefined, tint: string, minimal: boolean) {
  const paved = site === 'blacksite' || site === 'cinder_yard'
  const main = paved ? concrete : earth
  const second = paved ? earth : concrete
  const mat = makeTriplanarMaterial(main, { color: tint, roughness: .96, metalness: 0 }, {
    metresPerTile: paved ? 2.6 : 1.9,
    detail: minimal ? 0 : 9.7, detailAmount: .45,
    macro: minimal ? 0 : .11, macroAmount: .4,
  })
  if (!site || minimal) return mat
  const original = mat.onBeforeCompile, key = mat.customProgramCacheKey()
  const patchStrength = site === 'blacksite' ? .22 : site === 'cinder_yard' ? .58 : .35
  mat.onBeforeCompile = (shader, renderer) => {
    original(shader, renderer)
    Object.assign(shader.uniforms, {
      uGroundSecondary: { value: second.map }, uGroundRough: { value: second.roughnessMap },
      uGroundStrength: { value: patchStrength },
    })
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `
      uniform sampler2D uGroundSecondary;
      uniform sampler2D uGroundRough;
      uniform float uGroundStrength;
      float groundHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float groundNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(groundHash(i),groundHash(i+vec2(1,0)),f.x),mix(groundHash(i+vec2(0,1)),groundHash(i+vec2(1,1)),f.x),f.y);
      }
      void main() {`)
    // Insert after the existing map sampling, preserving its shadow/light pipeline.
    const marker = 'float roughnessFactor = roughness;'
    shader.fragmentShader = shader.fragmentShader.replace(marker, `
      vec2 groundUV = vTriPos.xz * 0.47;
      float groundPatch = smoothstep(0.30,0.72,groundNoise(vTriPos.xz * 0.085)) * uGroundStrength;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * texture2D(uGroundSecondary,groundUV).rgb,groundPatch);
      ${marker}`)
    // Triplanar has expanded the roughness chunk; apply the secondary roughness
    // just before the normal chunk's expansion, without replacing any light code.
    const normalMarker = 'vec3 triPn = triPos();'
    shader.fragmentShader = shader.fragmentShader.replace(normalMarker, `roughnessFactor = mix(roughnessFactor,roughness * texture2D(uGroundRough,groundUV).g,groundPatch);\n${normalMarker}`)
  }
  mat.customProgramCacheKey = () => `${key}:ground:${site}`
  return mat
}
