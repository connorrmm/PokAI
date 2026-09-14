'use client';
/**
 * The live portfolio: fetches, then hands off to the shared presentation.
 *
 * Presentation lives in PortfolioView so /preview/portfolio can render the
 * real component with sample numbers -- a separately built mockup drifts from
 * the product and then misrepresents it.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSession } from './Auth';
import NothingYet from './NothingYet';
import PortfolioView, { type Data } from './PortfolioView';

export default function Portfolio({ active = true }: { active?: boolean }) {
  const { session, ready, signInError, isAnonymous } = useSession();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (token: string) => {
    setError(null);
    try {
      const res = await fetch('/api/portfolio', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) {
        // Keep the build stamp the server attached. A screenshot of an error
        // that cannot be dated is a screenshot that has to be argued about.
        const b = json?.error?.build?.commit;
        const msg = json?.error?.message || `Could not load your portfolio (${res.status})`;
        setError(b && !msg.includes(b) ? `${msg} (build ${b})` : msg);
        return;
      }
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
      <NothingYet
        title="Nothing to value yet"
        body="Scan a card and add it, and this page starts tracking what your collection is worth from that moment."
        signInError={signInError}
      />
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

  return <PortfolioView data={data} isAnonymous={isAnonymous} />;
}
