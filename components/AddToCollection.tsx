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
import type { ApiCard } from '@/lib/scanner/types';
import { useSession } from './Auth';
import Auth from './Auth';

export default function AddToCollection({ card }: { card: ApiCard }) {
  const { session, ready } = useSession();
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

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
