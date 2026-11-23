import { describe, expect, it } from 'vitest'
import { enemyGait } from '../enemyGait'

// A guard facing +Z (facing = 0): forward is +z, its right is -x.
describe('what a guard\'s legs do', () => {
  it('stands when barely moving, rather than running on the spot', () => {
    expect(enemyGait(0, 0, 0).clip).toBe('idle')
    expect(enemyGait(0.1, 0.1, 0).clip).toBe('idle')
  })
  it('runs forward at manoeuvre speed, walks when slow or backing off', () => {
    expect(enemyGait(0, 2.8, 0).clip).toBe('run')
    expect(enemyGait(0, 1.2, 0).clip).toBe('walk')
    expect(enemyGait(0, -2.8, 0).clip).toBe('walk')
  })
  it('strafes when moving sideways to where it faces, on the correct side', () => {
    expect(enemyGait(-2.8, 0, 0).clip).toBe('strafeR')
    expect(enemyGait(2.8, 0, 0).clip).toBe('strafeL')
    // facing +X (pi/2): its right is +z... forward is +x
    expect(enemyGait(0, 0.4 + 2, Math.PI / 2).clip).toMatch(/strafe/)
    expect(enemyGait(2.8, 0, Math.PI / 2).clip).toBe('run')
  })
  it('plays each clip at a rate matched to speed, within sane bounds', () => {
    const slow = enemyGait(0, 2.0, 0), fast = enemyGait(0, 3.4, 0)
    expect(fast.rate).toBeGreaterThan(slow.rate)
    for (const s of [0.4, 1, 2, 2.8, 4, 9]) {
      const g = enemyGait(0, s, 0)
      expect(g.rate).toBeGreaterThanOrEqual(0.6)
      expect(g.rate).toBeLessThanOrEqual(1.6)
    }
  })
})
