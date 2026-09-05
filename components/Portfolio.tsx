'use client';
import { useCallback, useEffect, useState } from 'react';
import Auth, { useSession } from './Auth';
import Sparkline, { type Point } from './Sparkline';
import KeepCollection from './KeepCollection';
import type { Score, Achievement } from '@/lib/score';
import { tierOf, TIER_LABEL, TIER_COLOUR } from '@/lib/tier';

interface Holding {
  id: number; name: string | null; setName: string | null; number: string | null;
  rarity: string | null; imageUrl: string | null; marketPrice: number | null; quantity: number;
  condition: string | null;
}

/** One row of the collection, as the prototype's "recent pulls" list. */
function PullRow({ h }: { h: Holding }) {
  const tier = tierOf(h.rarity);
  return (
    <div className="card-row" style={{
      display: 'flex', gap: 12, alignItems: 'center', padding: 10, marginBottom: 8,
      borderLeft: `3px solid ${TIER_COLOUR[tier]}`,
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
          <span style={{
            fontSize: 9, padding: '2px 6px', borderRadius: 6, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.4px', marginLeft: 6,
            color: TIER_COLOUR[tier], border: `1px solid ${TIER_COLOUR[tier]}`,
          }}>{TIER_LABEL[tier]}</span>
        </div>
        <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>
          {[h.setName, h.number].filter(Boolean).join(' · ')}
          {h.condition && <span style={{ color: 'var(--gold)' }}> · {h.condition}</span>}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
        {typeof h.marketPrice === 'number'
          ? money(h.marketPrice * h.quantity)
          : <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>No price</span>}
      </div>
    </div>
  );
}
interface Data {
  totals: { cards: number; valued: number; unpriced: number; marketValue: number };
  change: { since: string; absolute: number; percent: number | null } | null;
  valuationUnavailable: boolean;
  series: Point[];
  top: Holding[];
  recent: Holding[];
  score: Score;
  achievements: Achievement[];
  itemCount: number;
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/**
 * Days between two calendar days, both read in UTC.
 *
 * Comparing `Date.now()` against a UTC midnight mixed two clocks: any load
 * after about midday UTC rounded up, so yesterday's snapshot was labelled
 * "2 days ago". Snapshots are keyed by UTC date, so the comparison has to be
 * as well.
 */
function sinceLabel(iso: string): string {
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.floor((todayUtc - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'since yesterday';
  return `since ${days} days ago`;
}

function SectionLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      margin: '22px 0 8px',
    }}>
      <span className="display" style={{ fontSize: 13, fontWeight: 600 }}>{children}</span>
      {hint && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{hint}</span>}
    </div>
  );
}

export default function Portfolio({ active = true }: { active?: boolean }) {
  const { session, ready, signInError, isAnonymous } = useSession();
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
    // Only when the tab is actually being looked at. Every load records
    // today's value, so fetching behind a hidden tab would write on open
    // whether or not anyone wanted to see it.
    if (!active) return;
    const t = session?.access_token;
    if (t) void load(t);
  }, [session, load, active]);

  if (!ready) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>;

  // No sign-in wall. An anonymous session is created automatically, so the
  // portfolio is simply there when the app opens. Auth only appears if that
  // failed, and then it says why.
  if (!session) {
    return (
      <div>
        {signInError && (
          <p style={{
            fontSize: 12.5, color: '#FF9C8A', background: 'rgba(232,72,58,0.12)',
            border: '1px solid rgba(232,72,58,0.35)', borderRadius: 12, padding: '10px 12px',
          }}>
            Could not start a session automatically: {signInError}
          </p>
        )}
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
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
        {data.valuationUnavailable ? (
          // Rule 2: an unpriced total is not a valuation. Never dress one up
          // as a real figure, and never compute a change from it.
          <div style={{ fontSize: 12, marginTop: 4, color: 'var(--gold)' }}>
            No prices available right now, so this total is not a valuation.
          </div>
        ) : data.change ? (
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

        {/* Collection Score, the prototype's formula unchanged. The breakdown
            is shown rather than hidden in a tooltip -- a single number nobody
            can decompose is a number nobody trusts. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14 }}>
          <div style={{
            flex: 1, height: 4, borderRadius: 2,
            background: 'rgba(255,255,255,0.08)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${Math.min(100, (data.score.total / data.score.measurableMax) * 100)}%`,
              background: 'linear-gradient(90deg, var(--accent), var(--gold))',
              transition: 'width .6s ease',
            }} />
          </div>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {data.score.total.toLocaleString()} pts
          </span>
        </div>
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 4 }}>
          value {data.score.value} · rarity {data.score.rarity} · sets {data.score.sets}
          {/* Never a silent zero: vintage genuinely cannot be measured yet. */}
          {data.score.vintage === null && ' · vintage not counted yet'}
        </div>

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

      <SectionLabel>Achievements</SectionLabel>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '2px 2px 8px' }}>
        {data.achievements.map((a) => (
          <div key={a.id} title={a.name} style={{
            flexShrink: 0, width: 72, display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 4, padding: '10px 6px', borderRadius: 14,
            background: a.earned ? 'rgba(255,176,32,0.08)' : 'var(--panel)',
            border: `1px solid ${a.earned ? 'rgba(255,176,32,0.4)' : 'var(--border)'}`,
            opacity: a.earned ? 1 : 0.35,
            filter: a.earned ? 'none' : 'grayscale(1)',
          }}>
            <div style={{ fontSize: 20 }}>{a.icon}</div>
            <div style={{
              fontSize: 8.5, textAlign: 'center', lineHeight: 1.25, fontWeight: 600,
              color: a.earned ? 'var(--fg)' : 'var(--muted)',
            }}>{a.name}</div>
          </div>
        ))}
      </div>

      {data.recent.length > 0 && (
        <>
          <SectionLabel hint="most recent first">Recent pulls</SectionLabel>
          {data.recent.map((h) => <PullRow key={h.id} h={h} />)}
        </>
      )}

      {data.top.length > 0 && (
        <>
          <SectionLabel hint={`${data.itemCount} in your collection`}>Most valuable</SectionLabel>
          {data.top.map((h) => <PullRow key={`top-${h.id}`} h={h} />)}
        </>
      )}

      {/* The other half of signing people in anonymously: a way out of it,
          offered once there is something worth keeping. */}
      {isAnonymous && <KeepCollection cardCount={data.totals.cards} />}

      {data.totals.cards === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 18 }}>
          Nothing here yet. <a href="/">Scan a card</a> and add it to your collection.
        </p>
      )}
    </div>
  );
}
