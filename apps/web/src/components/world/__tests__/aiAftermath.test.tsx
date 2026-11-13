import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AIResponse } from '../Consequence'

describe('AI operation aftermath', () => {
  it('distinguishes executed moves from rejected proposals and no action', () => {
    const html = renderToStaticMarkup(<AIResponse review={{ seq: 1, tick: 42, payload: { ok: true, model: 'test', outcome: { assessment: 'Our reserves are low.', results: [
      { type: 'request_supplies', validation: 'accepted' },
      { type: 'post_bounty', validation: 'rejected_by_policy', error: 'over budget' },
      { type: 'none', validation: 'no_action' },
    ] } } }} />)
    expect(html).toContain('Request supplies: executed by the economy')
    expect(html).toContain('Post a bounty: rejected')
    expect(html).toContain('Hold position: no additional action')
    expect(html).toContain('on-chain confirmation is tracked separately')
  })
  it('does not show a failed review as an executed response', () => {
    const html = renderToStaticMarkup(<AIResponse review={{ seq: 2, tick: 42, payload: { ok: false, model: 'test' } }} />)
    expect(html).toContain('AI review failed')
    expect(html).not.toContain('executed by the economy')
  })
})
