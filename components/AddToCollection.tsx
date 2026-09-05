'use client';
/**
 * "Add to my collection" — the step that turns identifying a card into owning
 * a record of it.
 *
 * Offered on a card the user has CHOSEN as well as one the scanner named
 * outright. A collector picking the right print out of four is making exactly
 * the decision the app could not, and it would be perverse to make them scan
 * again to keep it.
 */
import { useState } from 'react';
import { CONDITIONS, CONDITION_SHORT, type Condition } from '@/lib/condition';
import type { ApiCard } from '@/lib/scanner/types';
import type { CardRead } from '@/lib/scanner/vision-types';
import { logScan } from '@/lib/scan-log';
import { useSession } from './Auth';
import Auth from './Auth';

export default function AddToCollection({
  card, predicted, read, confidence, candidateCount, autoAccepted = false,
}: {
  card: ApiCard;
  /** What the scanner led with. Differs from `card` when the user overruled it. */
  predicted?: ApiCard | null;
  read?: CardRead | null;
  confidence?: number | null;
  candidateCount?: number | null;
  /**
   * Did the SCANNER name this card, or did the user pick it?
   *
   * Passed explicitly rather than inferred by comparing ids. Inferring it
   * meant that tapping the FIRST row of a never-guess candidate list recorded
   * `auto_accepted = true` -- so the app would have counted its own unanswered
   * questions as successful identifications, inflating the exact accuracy
   * signal this feature exists to measure.
   */
  autoAccepted?: boolean;
}) {
  const { session, ready } = useSession();
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  /**
   * Unset by default, never Near Mint. Defaulting to the best grade quietly
   * inflates every collection whose owner never touches this, and the person
   * who would notice is the one who trusted the total.
   */
  const [condition, setCondition] = useState<Condition | null>(null);

  async function add() {
    const token = session?.access_token;
    if (!token) { setSigningIn(true); return; }
    setState('saving');
    setError(null);
    try {
      const res = await fetch('/api/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          cardId: card.id,
          // The snapshot the row keeps forever, so the collection survives the
          // cached catalog being purged (migration 0005).
          name: card.name,
          setName: card.setName,
          number: card.number,
          condition,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        // Rule 4: the real reason, not "could not save".
        setError(json?.error?.message || `Could not save that card (${res.status})`);
        setState('idle');
        return;
      }
      setState('saved');

      // The card is safely saved, so history and the correction can be
      // recorded now without any risk of a bookkeeping failure costing the
      // user the thing they actually wanted.
      void logScan(session, {
        read: read ?? null,
        confidence: confidence ?? null,
        autoAccepted,
        candidateCount: candidateCount ?? null,
        card,
        predicted: predicted ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('idle');
    }
  }

  if (!ready) return null;

  if (signingIn && !session) {
    return (
      <div style={{
        marginTop: 12, padding: 14, borderRadius: 16,
        background: 'var(--panel)', border: '1px solid var(--border)',
      }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
          Sign in to keep this card. No password — we email you a link.
        </p>
        <Auth />
      </div>
    );
  }

  if (state === 'saved') {
    return (
      <p style={{ marginTop: 12, fontSize: 13, color: 'var(--mint)' }}>
        Added to your collection. <a href="/collection">See your collection →</a>
      </p>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      {/* Condition is asked, never inferred. A grade is a judgement about
          edges, surface and centring that a photograph cannot make, and a
          machine-assigned one would be a valuation nobody agreed to
          (docs/OPEN-QUESTIONS.md #8). */}
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
        Condition <span style={{ opacity: 0.7 }}>— optional</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {CONDITIONS.map((c) => {
          const on = condition === c;
          return (
            <button
              key={c} onClick={() => setCondition(on ? null : c)}
              aria-pressed={on} title={c}
              className="mono"
              style={{
                flex: 1, padding: '8px 2px', borderRadius: 10, cursor: 'pointer',
                fontSize: 11, fontWeight: 700,
                background: on ? 'rgba(232,72,58,0.16)' : 'var(--panel)',
                color: on ? 'var(--accent-warm)' : 'var(--muted)',
                border: `1px solid ${on ? 'rgba(232,72,58,0.45)' : 'var(--border)'}`,
              }}
            >
              {CONDITION_SHORT[c]}
            </button>
          );
        })}
      </div>

      <button
        onClick={add} disabled={state === 'saving'} className="btn-ghost"
        style={{ width: '100%', padding: 13, fontSize: 14, cursor: 'pointer', opacity: state === 'saving' ? 0.6 : 1 }}
      >
        {state === 'saving' ? 'Saving…' : 'Add to my collection'}
      </button>
      {error && (
        <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12.5, color: '#FF9C8A' }}>{error}</p>
      )}
    </div>
  );
}
