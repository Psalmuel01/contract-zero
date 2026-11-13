'use client'

// The five-part story of what an operation did to the world, from the server's recorded
// snapshots, with the raw records one click away. The commander's reaction fills in by
// itself when its next turn is logged; until then it says it is waiting.

import { useQuery } from '@tanstack/react-query'
import { api, type AIReview, type MissionResult } from '@/lib/api'
import { describeConsequence, type StepState } from '@/lib/presenter/consequence'

const MARK: Record<StepState, { glyph: string; cls: string; label: string }> = {
  done: { glyph: '●', cls: 'text-friendly', label: 'recorded' },
  pending: { glyph: '○', cls: 'text-amber-hi', label: 'waiting' },
  none: { glyph: '–', cls: 'text-dim', label: 'not recorded' },
}

export function ConsequencePanel({ session, result }: { session: string; result: MissionResult }) {
  const c = result.consequence ?? null
  const settled = !!c?.after
  // Poll the target's decisions until it has acted; stop once it has (or there is no record).
  const after = useQuery({
    queryKey: ['aftermath', session],
    queryFn: () => api.aftermath(session),
    enabled: settled,
    refetchInterval: (q) => ((q.state.data?.ai_reviews?.length ?? 0) > 0 || (q.state.data?.ai_configured === false && (q.state.data?.decisions.length ?? 0) > 0) ? false : 5_000),
  })
  const story = describeConsequence(result, c, after.data)
  return (
    <section className="cz-panel mt-4 p-4" data-testid="consequence">
      <h2 className="cz-label mb-3">What this did to the world</h2>
      <ol className="grid gap-3">
        {story.steps.map((s, i) => (
          <li key={s.key} className="grid grid-cols-[1.75rem_1fr] gap-2" data-testid={`consequence-${s.key}`}>
            <span className={`mt-0.5 text-center font-mono text-sm ${MARK[s.state].cls}`} role="img" aria-label={MARK[s.state].label}>{MARK[s.state].glyph}</span>
            <div>
              <div className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-steel">{i + 1}. {s.title}</div>
              <ul className="mt-0.5 grid gap-0.5 text-sm text-fog">
                {s.lines.map((l, j) => <li key={j} className={s.state === 'pending' ? 'text-muted' : ''}>{l}</li>)}
              </ul>
            </div>
          </li>
        ))}
      </ol>
      {settled && result.outcome === 'extracted' && (
        <div className="mt-5 border-t border-line pt-4" data-testid="ai-aftermath">
          <h3 className="cz-label text-amber-hi">Your operation → command response</h3>
          <p className="mt-2 text-sm text-muted">You {result.kind === 'sabotage' ? 'destroyed' : result.kind === 'recovery' ? 'recovered' : 'extracted'} {result.extracted_units} {result.resource} at {result.site?.name ?? c?.before.name ?? result.target}.</p>
          {after.isError ? <p className="mt-2 text-sm text-amber-hi">Could not load the response. Retrying…</p>
            : after.data?.ai_reviews?.length ? after.data.ai_reviews.map((review) => <AIResponse key={review.seq} review={review} />)
            : <p className="mt-2 text-sm text-muted">{after.data?.ai_configured === false ? 'AI planning is off. Routine faction decisions continue above.' : 'Awaiting the faction’s AI review. Events during a cooldown are grouped; this report updates automatically.'}</p>}
        </div>
      )}
      {c && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer text-steel hover:text-fog">Advanced evidence (recorded snapshots)</summary>
          <pre className="mt-2 max-h-72 overflow-auto bg-ink-2 p-2 font-mono text-[11px] text-fog">{JSON.stringify({ before: c.before, faced: c.faced, after: c.after, next: c.next, settled_tick: c.settled_tick, decisions: after.data?.decisions }, null, 2)}</pre>
        </details>
      )}
    </section>
  )
}

const ACTION_LABEL: Record<string, string> = {
  request_supplies: 'Request supplies', trade: 'Trade supplies', post_bounty: 'Post a bounty',
  configure_defense: 'Change defenses', seize_convoy: 'Seize a convoy', set_margin: 'Adjust pricing',
  post_sabotage: 'Sponsor sabotage', none: 'Hold position',
}

export function AIResponse({ review }: { review: AIReview }) {
  const { payload: p } = review
  if (!p.ok || p.outcome?.error) return <p className="mt-2 text-sm text-amber-hi">The AI review failed. Routine policies continue; no AI response is confirmed for this review.</p>
  return <div className="mt-3 border-l-2 border-amber pl-3">
    <p className="text-xs text-steel">AI review recorded · world hour {review.tick} · your operation was included in this review</p>
    {p.outcome?.assessment && <p className="mt-1 text-sm text-fog">{p.outcome.assessment}</p>}
    <ul className="mt-2 space-y-1 text-sm">
      {p.outcome?.results?.map((r, i) => <li key={i}>
        <span className={r.validation === 'accepted' ? 'text-friendly' : 'text-muted'}>{ACTION_LABEL[r.type] ?? r.type}: {r.validation === 'accepted' ? 'executed by the economy' : r.validation === 'no_action' ? 'no additional action' : 'rejected'}</span>
        {r.error && <span className="text-muted"> — {r.error}</span>}
        {r.rationale && <p className="mt-0.5 text-xs text-muted">Command’s rationale: {r.rationale}</p>}
      </li>)}
    </ul>
    {!p.outcome?.results?.length && <p className="mt-1 text-sm text-muted">No additional moves were recorded.</p>}
    <p className="mt-2 text-xs text-dim">Accepted moves change the economy; on-chain confirmation is tracked separately. A review may include several world events.</p>
  </div>
}
