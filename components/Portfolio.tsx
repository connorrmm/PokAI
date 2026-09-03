'use client';
import { useCallback, useEffect, useState } from 'react';
import Auth, { useSession } from './Auth';
import Sparkline, { type Point } from './Sparkline';

interface Holding {
  id: number; name: string | null; setName: string | null; number: string | null;
  rarity: string | null; imageUrl: string | null; marketPrice: number | null; quantity: number;
}
interface Data {
  totals: { cards: number; valued: number; unpriced: number; marketValue: number };
  change: { since: string; absolute: number; percent: number | null } | null;
  series: Point[];
  top: Holding[];
  itemCount: number;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function sinceLabel(iso: string): string {
  const days = Math.round((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'since yesterday';
  return `since ${days} days ago`;
}

export default function Portfolio() {
  const { session, ready } = useSession();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (token: string) => {
    setError(null);
    try {
      const res = await fetch('/api/portfolio', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message || `Could not load your portfolio (${res.status})`); return; }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const t = session?.access_token;
    if (t) void load(t);
  }, [session, load]);

  if (!ready) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>;

  if (!session) {
    return (
      <div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
          Sign in to see what your collection is worth.
        </p>
        <Auth />
      </div>
    );
  }

  if (error) {
    return (
      <p style={{
        fontSize: 13, color: '#FF9C8A', background: 'rgba(232,72,58,0.12)',
        border: '1px solid rgba(232,72,58,0.35)', borderRadius: 12, padding: '10px 12px',
      }}>{error}</p>
    );
  }

  if (!data) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>;

  const rising = (data.change?.absolute ?? 0) >= 0;

  return (
    <div>
      <div style={{
        padding: 20, borderRadius: 20,
        background: 'linear-gradient(150deg, rgba(232,72,58,0.10), rgba(0,217,163,0.10))',
        border: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Total collection value</div>
        <div className="display mono" style={{ fontSize: 32, fontWeight: 700, marginTop: 4 }}>
          {money(data.totals.marketValue)}
        </div>

        {/* Direction is carried by the ARROW AND THE WORDS. Colour only
            reinforces it -- mint against coral is the red/green pair a
            colour-blind reader cannot separate. */}
        {data.change ? (
          <div className="mono" style={{
            fontSize: 12, marginTop: 4, fontWeight: 600,
            color: rising ? 'var(--mint)' : 'var(--accent-warm)',
          }}>
            {rising ? '▲ up ' : '▼ down '}
            {money(Math.abs(data.change.absolute))}
            {data.change.percent !== null && ` (${Math.abs(data.change.percent)}%)`}
            {' '}{sinceLabel(data.change.since)}
          </div>
        ) : (
          <div style={{ fontSize: 12, marginTop: 4, color: 'var(--muted)' }}>
            No change to show yet — this is the first day recorded.
          </div>
        )}

        <Sparkline points={data.series} rising={rising} />

        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
          {data.totals.cards} card{data.totals.cards === 1 ? '' : 's'}
          {/* Rule 2: a partial total must never read as a complete one. */}
          {data.totals.unpriced > 0 && (
            <> · <span style={{ color: 'var(--gold)' }}>
              {data.totals.unpriced} with no price available, not in this total
            </span></>
          )}
        </div>
      </div>

      {data.top.length > 0 && (
        <>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            margin: '22px 0 8px',
          }}>
            <span className="display" style={{ fontSize: 13, fontWeight: 600 }}>Most valuable</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              {data.itemCount} in your collection
            </span>
          </div>
          {data.top.map((h) => (
            <div key={h.id} className="card-row" style={{
              display: 'flex', gap: 12, alignItems: 'center', padding: 10, marginBottom: 8,
            }}>
              {h.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={h.imageUrl} alt="" width={40} height={55}
                     style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="display" style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {h.quantity > 1 && <span className="mono" style={{ color: 'var(--muted)' }}>{h.quantity}× </span>}
                  {h.name ?? 'Unnamed card'}
                </div>
                <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>
                  {[h.setName, h.number, h.rarity].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                {money((h.marketPrice as number) * h.quantity)}
              </div>
            </div>
          ))}
        </>
      )}

      {data.totals.cards === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 18 }}>
          Nothing here yet. <a href="/">Scan a card</a> and add it to your collection.
        </p>
      )}
    </div>
  );
}
