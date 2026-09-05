'use client';
import { useCallback, useEffect, useState } from 'react';
import Auth, { useSession } from './Auth';

interface Item {
  id: number;
  cardId: number | null;
  quantity: number;
  condition: string | null;
  name: string | null;
  setName: string | null;
  number: string | null;
  rarity: string | null;
  imageUrl: string | null;
  marketPrice: number | null;
  addedAt: string;
}
interface Totals { cards: number; valued: number; unpriced: number; marketValue: number }

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Collection() {
  const { session, ready, signOut } = useSession();
  const [items, setItems] = useState<Item[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (token: string) => {
    setError(null);
    try {
      const res = await fetch('/api/collection', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message || `Could not load your collection (${res.status})`); return; }
      setItems(json.items);
      setTotals(json.totals);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const token = session?.access_token;
    if (token) void load(token);
  }, [session, load]);

  if (!ready) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>;

  if (!session) {
    return (
      <div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
          Sign in to keep the cards you scan. Your collection is yours — nobody else can read it.
        </p>
        <Auth />
      </div>
    );
  }

  return (
    <div>
      {totals && (
        <div style={{
          background: 'var(--panel)', border: '1px solid var(--border)',
          borderRadius: 16, padding: 16, marginBottom: 16,
        }}>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700 }}>
            {money(totals.marketValue)}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
            {totals.cards} card{totals.cards === 1 ? '' : 's'}
            {/* Rule 2: never let a partial total read as a complete one. */}
            {totals.unpriced > 0 && (
              <> · <span style={{ color: 'var(--gold)' }}>
                {totals.unpriced} with no price available, not counted in this total
              </span></>
            )}
          </div>
        </div>
      )}

      {error && (
        <p style={{
          fontSize: 13, color: '#FF9C8A', background: 'rgba(232,72,58,0.12)',
          border: '1px solid rgba(232,72,58,0.35)', borderRadius: 12, padding: '10px 12px',
        }}>{error}</p>
      )}

      {items && items.length === 0 && !error && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          Nothing here yet. <a href="/">Scan a card</a> and tap “Add to my collection”.
        </p>
      )}

      {items?.map((it) => (
        <div key={it.id} className="card-row" style={{
          display: 'flex', gap: 12, alignItems: 'center', padding: 10, marginBottom: 8,
        }}>
          {it.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.imageUrl} alt="" width={44} height={60}
                 style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="display" style={{ fontWeight: 600, fontSize: 14 }}>
              {it.quantity > 1 && <span className="mono" style={{ color: 'var(--muted)' }}>{it.quantity}× </span>}
              {it.name ?? 'Unnamed card'}
            </div>
            <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>
              {[it.setName, it.number, it.rarity].filter(Boolean).join(' · ')}
              {it.condition && (
                <span style={{ color: 'var(--gold)' }}> · {it.condition}</span>
              )}
            </div>
          </div>
          <div className="mono" style={{ textAlign: 'right', flexShrink: 0, fontSize: 14, fontWeight: 600 }}>
            {typeof it.marketPrice === 'number'
              ? money(it.marketPrice * it.quantity)
              : <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>Value unavailable</span>}
          </div>
        </div>
      ))}

      <button onClick={signOut} className="btn-ghost"
              style={{ width: '100%', padding: 12, marginTop: 20, fontSize: 13, cursor: 'pointer' }}>
        Sign out
      </button>
    </div>
  );
}
