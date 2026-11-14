import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { API, type ServerRadioLine } from '@/lib/api'
import { RadioQueue } from '@/engine/story/strategicRadio'

// The server writes the radio (apps/api services/radio.rs); the feed shows and voices its text.
const decisions: { current: ServerRadioLine[] } = { current: [] }
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: { radio: () => Promise.resolve(decisions.current) } }))
const vo = vi.fn()
const prefetchVo = vi.fn()
const unlocked = { current: true }
vi.mock('@/engine/audio/shared', () => ({ peekAudio: () => ({ isUnlocked: () => unlocked.current, vo, prefetchVo }) }))
// a fresh, fast queue per test (the real one is a singleton with a 20 s gap)
const q: { current: RadioQueue } = { current: new RadioQueue({ gapMs: 0 }) }
vi.mock('@/engine/story/strategicRadio', async (orig) => { const m = await orig<typeof import('@/engine/story/strategicRadio')>(); return { ...m, get strategicQueue() { return q.current } } })
import { RadioFeed } from '../RadioFeed'

const dec = (seq: number, have: number): ServerRadioLine => ({ key: `decision-${seq}`, speaker: 'vanguard', text: `Medicine at ${have} of 24. Logged. Resupply is ordered.`, tick: seq, evidence: 'vanguard: med below target', audio: `/radio/decision-${seq}/vo` })
const mount = (client: QueryClient) => render(<QueryClientProvider client={client}><RadioFeed /></QueryClientProvider>)

beforeEach(() => { vo.mockClear(); prefetchVo.mockClear(); unlocked.current = true; decisions.current = [dec(1, 20)]; q.current = new RadioQueue({ gapMs: 0 }) })
afterEach(() => { localStorage.clear() })

describe('RadioFeed', () => {
  it('does not broadcast history, then says a new real event with subtitles and the radio signature', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mount(client)
    await waitFor(() => expect(client.getQueryData(['radio-lines'])).toBeTruthy())
    await new Promise((r) => setTimeout(r, 1300))
    expect(vo).not.toHaveBeenCalled()                    // the event already there is history
    expect(screen.queryByTestId('radio-line')).toBeNull()
    decisions.current = [dec(1, 20), dec(2, 17)]         // a new decision is logged
    await client.refetchQueries({ queryKey: ['radio-lines'] })
    await waitFor(() => expect(screen.getByTestId('radio-line')).toBeTruthy(), { timeout: 3000 })
    expect(screen.getByTestId('radio-line').textContent).toContain('Medicine at 17 of 24')
    expect(screen.getByTestId('radio-line').textContent).toContain('VANGUARD COMMAND')
    expect(vo).toHaveBeenCalledTimes(1)
    expect(vo.mock.calls[0][1]).toBe('vanguard')
    // the server's voice for exactly the text on screen, fetched before its turn
    expect(vo.mock.calls[0][0]).toBe('radio-decision-2')
    expect(vo.mock.calls[0][3]).toBe(`${API}/radio/decision-2/vo`)
    expect(prefetchVo).toHaveBeenCalledWith(`${API}/radio/decision-2/vo`)
  })
  it('holds a line until a gesture has unlocked audio, so it is not lost to silence', async () => {
    unlocked.current = false
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mount(client)
    await waitFor(() => expect(client.getQueryData(['radio-lines'])).toBeTruthy())
    decisions.current = [dec(1, 20), dec(3, 15)]
    await client.refetchQueries({ queryKey: ['radio-lines'] })
    await new Promise((r) => setTimeout(r, 1300))
    expect(vo).not.toHaveBeenCalled()
    expect(q.current.pending()).toBe(1)
    unlocked.current = true
    await waitFor(() => expect(vo).toHaveBeenCalledTimes(1), { timeout: 3000 })
  })
  it('with subtitles off the words are not shown but remain for screen readers', async () => {
    localStorage.setItem('cz_settings', JSON.stringify({ version: 3, subtitles: { on: false } }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    mount(client)
    await waitFor(() => expect(client.getQueryData(['radio-lines'])).toBeTruthy())
    decisions.current = [dec(1, 20), dec(4, 12)]
    await client.refetchQueries({ queryKey: ['radio-lines'] })
    await waitFor(() => expect(vo).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(screen.queryByTestId('radio-line')).toBeNull()
    expect(screen.getByTestId('radio-feed').textContent).toContain('Medicine at 12 of 24')
    expect(screen.getByTestId('radio-feed').getAttribute('aria-live')).toBe('polite')
  })
})
