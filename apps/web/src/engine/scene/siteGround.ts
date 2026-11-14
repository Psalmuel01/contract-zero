import { makeTriplanarMaterial } from './triplanar'
import type { PbrMaps } from './usePbr'
import type { LevelId } from '../fps/levels'

/** A road laid into the ground: an axis-aligned rectangle in world metres. */
export interface RoadRect { x: number; z: number; w: number; d: number }
const MAX_ROADS = 3

/**
 * The site's ground: one material, three surfaces.
 *
 * Reuses the already-shipped maps (no new texture allocations): the main surface
 * (earth or hardstanding), weathered patches of the other, and asphalt where the
 * level lays a road. The road used to be a separate slab 2 cm proud of the floor with
 * a hard, dead-straight edge; blended here it has a ragged, worn edge, a darker
 * wheel-polished centre, and no step. Low keeps a single surface sample and the slab.
 */
export function makeSiteGround(earth: PbrMaps, concrete: PbrMaps, site: LevelId | undefined, tint: string, minimal: boolean, asphalt?: PbrMaps, roads: RoadRect[] = []) {
  const paved = site === 'blacksite' || site === 'cinder_yard'
  const main = paved ? concrete : earth
  const second = paved ? earth : concrete
  const mat = makeTriplanarMaterial(main, { color: tint, roughness: .96, metalness: 0 }, {
    metresPerTile: paved ? 2.6 : 1.9,
    detail: minimal ? 0 : 9.7, detailAmount: paved ? .6 : .45,
    // Poured hardstanding read as one flat sheet past ten metres: stronger macro
    // variation gives it the bays and stains a yard slab carries.
    macro: minimal ? 0 : paved ? .07 : .11, macroAmount: paved ? .6 : .4,
  })
  if (!site || minimal) return mat
  const original = mat.onBeforeCompile, key = mat.customProgramCacheKey()
  const patchStrength = site === 'blacksite' ? .22 : site === 'cinder_yard' ? .58 : .35
  const roadList = asphalt ? roads.slice(0, MAX_ROADS) : []
  const roadRects = Array.from({ length: MAX_ROADS }, (_, i) => {
    const r = roadList[i]
    return r ? [r.x - r.w / 2, r.x + r.w / 2, r.z - r.d / 2, r.z + r.d / 2] : [0, 0, 0, 0]
  }).flat()
  mat.onBeforeCompile = (shader, renderer) => {
    original(shader, renderer)
    Object.assign(shader.uniforms, {
      uGroundSecondary: { value: second.map }, uGroundRough: { value: second.roughnessMap },
      uGroundStrength: { value: patchStrength },
      uRoadMap: { value: asphalt?.map ?? null }, uRoadRough: { value: asphalt?.roughnessMap ?? null },
      uRoads: { value: new Float32Array(roadRects) }, uRoadCount: { value: roadList.length },
    })
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `
      uniform sampler2D uGroundSecondary;
      uniform sampler2D uGroundRough;
      uniform float uGroundStrength;
      uniform sampler2D uRoadMap;
      uniform sampler2D uRoadRough;
      uniform float uRoads[${MAX_ROADS * 4}];
      uniform int uRoadCount;
      float groundHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float groundNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(groundHash(i),groundHash(i+vec2(1,0)),f.x),mix(groundHash(i+vec2(0,1)),groundHash(i+vec2(1,1)),f.x),f.y);
      }
      // 1 on the road, 0 off it, with a ragged edge; .y is the across-road coordinate (-1..1) for the wheel polish.
      vec2 roadMask(vec2 p) {
        float best = 0.0; float across = 0.0;
        for (int i = 0; i < ${MAX_ROADS}; i++) {
          if (i >= uRoadCount) break;
          float x0 = uRoads[i*4], x1 = uRoads[i*4+1], z0 = uRoads[i*4+2], z1 = uRoads[i*4+3];
          // signed distance to the rectangle's edge (negative inside)
          vec2 c = vec2((x0 + x1) * 0.5, (z0 + z1) * 0.5), h = vec2((x1 - x0) * 0.5, (z1 - z0) * 0.5);
          vec2 q = abs(p - c) - h;
          float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
          float edge = (groundNoise(p * 0.9) - 0.5) * 0.9 + (groundNoise(p * 3.1) - 0.5) * 0.35;
          float m = 1.0 - smoothstep(-0.35, 0.35, sd + edge);
          if (m > best) { best = m; across = h.x < h.y ? (p.x - c.x) / h.x : (p.y - c.y) / h.y; }
        }
        return vec2(best, across);
      }
      void main() {`)
    // Insert after the existing map sampling, preserving its shadow/light pipeline.
    const marker = 'float roughnessFactor = roughness;'
    shader.fragmentShader = shader.fragmentShader.replace(marker, `
      vec2 groundUV = vTriPos.xz * 0.47;
      float groundPatch = smoothstep(0.30,0.72,groundNoise(vTriPos.xz * 0.085)) * uGroundStrength;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * texture2D(uGroundSecondary,groundUV).rgb,groundPatch);
      vec2 groundRoad = uRoadCount > 0 ? roadMask(vTriPos.xz) : vec2(0.0);
      if (groundRoad.x > 0.001) {
        vec2 roadUV = vTriPos.xz * 0.31;
        vec3 roadCol = texture2D(uRoadMap, roadUV).rgb;
        // Wheel tracks polish two bands darker; the crown between them keeps its grit.
        float lane = abs(abs(groundRoad.y) - 0.55);
        float polish = (1.0 - smoothstep(0.0, 0.22, lane)) * 0.28;
        roadCol *= 1.0 - polish + (groundNoise(vTriPos.xz * 0.25) - 0.5) * 0.18;
        diffuseColor.rgb = mix(diffuseColor.rgb, roadCol * 0.92, groundRoad.x);
      }
      ${marker}`)
    // Triplanar has expanded the roughness chunk; apply the secondary roughness
    // just before the normal chunk's expansion, without replacing any light code.
    const normalMarker = 'vec3 triPn = triPos();'
    shader.fragmentShader = shader.fragmentShader.replace(normalMarker, `roughnessFactor = mix(roughnessFactor,roughness * texture2D(uGroundRough,groundUV).g,groundPatch);
      if (groundRoad.x > 0.001) roughnessFactor = mix(roughnessFactor, 0.78 + 0.2 * texture2D(uRoadRough, vTriPos.xz * 0.31).g, groundRoad.x);
      ${normalMarker}`)
  }
  mat.customProgramCacheKey = () => `${key}:ground:${site}:${roadList.length}`
  return mat
}
