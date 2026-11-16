import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rigClipName } from '../rigClips'

// Read operator.glb directly: each animation's Hips translation track, start to end.
function hipsTravelX(): Record<string, number> {
  const buf = readFileSync(join(__dirname, '../../../../public/characters/glb/operator.glb'))
  const jsonLen = buf.readUInt32LE(12)
  const g = JSON.parse(buf.subarray(20, 20 + jsonLen).toString())
  const bin = 20 + jsonLen + 8
  const hips = g.nodes.findIndex((n: { name: string }) => /Hips$/.test(n.name))
  const out: Record<string, number> = {}
  for (const an of g.animations) {
    const ch = an.channels.find((c: { target: { node: number; path: string } }) => c.target.node === hips && c.target.path === 'translation')
    if (!ch) continue
    const a = g.accessors[an.samplers[ch.sampler].output], bv = g.bufferViews[a.bufferView]
    const at = (i: number) => buf.readFloatLE(bin + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * 12)
    out[an.name] = at(a.count - 1) - at(0)
  }
  return out
}

describe('the guard rig\'s strafe clips', () => {
  // The rig faces +Z; its right is -X (enemyGait's convention, and the model's left
  // thigh sits at +X).
  const travel = hipsTravelX()
  const playedAs = (clip: string) => Object.keys(travel).find((k) => rigClipName(k) === clip)!

  it('play the clip that actually steps right as strafeR, and left as strafeL', () => {
    expect(travel[playedAs('strafeR')]).toBeLessThan(-50) // cm toward -X: the character's right
    expect(travel[playedAs('strafeL')]).toBeGreaterThan(50)
  })

  it('leave every other clip under its own name', () => {
    for (const n of ['idle', 'walk', 'run', 'fire', 'reload', 'hit', 'death']) expect(rigClipName(n)).toBe(n)
  })
})
