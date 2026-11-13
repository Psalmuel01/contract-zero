import { afterEach, describe, expect, it, vi } from 'vitest'
import { reqRetrying } from '../api'

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('reqRetrying (idempotent calls such as completing a mission)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('retries while the API says it is busy, then returns the result', async () => {
    vi.useFakeTimers()
    const f = vi.fn().mockResolvedValueOnce(res(503, { error: 'busy' }, { 'retry-after': '1' })).mockResolvedValueOnce(res(200, { replayed: false }))
    vi.stubGlobal('fetch', f)
    const p = reqRetrying('/missions/x/complete', { method: 'POST' })
    await vi.advanceTimersByTimeAsync(1000)
    await expect(p).resolves.toEqual({ replayed: false })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('retries a dropped connection', async () => {
    vi.useFakeTimers()
    const f = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(res(200, { ok: 1 }))
    vi.stubGlobal('fetch', f)
    const p = reqRetrying('/x')
    await vi.advanceTimersByTimeAsync(1000)
    await expect(p).resolves.toEqual({ ok: 1 })
  })

  it('does not retry a real refusal, and gives up after its attempts', async () => {
    const f = vi.fn().mockImplementation(async () => res(400, { error: 'that operation is over' }))
    vi.stubGlobal('fetch', f)
    await expect(reqRetrying('/x')).rejects.toThrow('that operation is over')
    expect(f).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    const g = vi.fn().mockImplementation(async () => res(503, { error: 'busy' }))
    vi.stubGlobal('fetch', g)
    const p = reqRetrying('/x', undefined, 3).catch((e) => e)
    await vi.advanceTimersByTimeAsync(20000)
    expect(String(await p)).toContain('busy')
    expect(g).toHaveBeenCalledTimes(3)
  })
})
