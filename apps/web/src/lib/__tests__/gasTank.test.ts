import { describe, expect, it } from 'vitest'
import { spendable } from '../auth'

const NEAR = 10n ** 24n

describe('the gas tank\'s view of an account', () => {
  it('counts only what storage does not lock (same rule as the server)', () => {
    expect(spendable((NEAR / 10n).toString(), 182)).toBe(NEAR / 10n - 182n * 10n ** 19n)
    expect(spendable('0', 182)).toBe(0n)
  })
})
