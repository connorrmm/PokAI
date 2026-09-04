'use client';
import { useCallback, useEffect, useState } from 'react';
import Auth, { useSession } from './Auth';

interface Row {
  id: number; at: string; confidence: number | null; autoAccepted: boolean;
  cardId: number | null; name: string | null; setName: string | null; number: string | null;
  imageUrl: string | null; errorDetail: string | null;
  readName: string | null; readNumber: string | null;
  candidateCount: number | null; corrected: boolean;
}

function when(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function History() {
  const { session, ready } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (token: string) => {
    setError(null);
    try {
      const res = await fetch('/api/scans', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) { setError(json?.error?.message || `Could not load your history (${res.status})`); return; }
      setRows(Array.isArray(json?.items) ? json.items : []);
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
          Sign in to keep a record of what you have scanned.
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

  // Without this a signed-in user sees a bare header while the fetch runs --
  // and forever, if the response ever arrives without `items`.
  if (rows === null) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</p>;

  if (rows.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>
        No scans recorded yet. <a href="/">Scan a card</a> and add it to your collection —
        history is written when you keep a card.
      </p>
    );
  }

  const corrections = rows.filter((r) => r.corrected).length;

  return (
    <div>
      {corrections > 0 && (
        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 0, marginBottom: 14 }}>
          You corrected the scanner on{' '}
          <strong style={{ color: 'var(--gold)' }}>{corrections}</strong>{' '}
          of {rows.length} scans. Each of those is a record of cards it cannot yet tell apart.
        </p>
      )}

      {rows.map((r) => (
        <div key={r.id} className="card-row" style={{
          display: 'flex', gap: 12, alignItems: 'center', padding: 10, marginBottom: 8,
        }}>
          {r.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.imageUrl} alt="" width={40} height={55}
                 style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="display" style={{ fontWeight: 600, fontSize: 13.5 }}>
              {r.name ?? r.readName ?? 'Unresolved scan'}
            </div>
            <div className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>
              {[r.setName, r.number].filter(Boolean).join(' · ') || r.readNumber || '—'}
            </div>
            {/* Which of the two things happened, in plain words: the scanner
                named it, or it asked and the user chose. */}
            <div style={{ fontSize: 10.5, marginTop: 3, color: 'var(--muted)' }}>
              {r.corrected
                ? <span style={{ color: 'var(--gold)' }}>you picked this — the scanner led with something else</span>
                : r.autoAccepted
                  ? 'identified outright'
                  : r.candidateCount
                    ? `you picked this from ${r.candidateCount} options`
                    : 'you picked this'}
              {r.confidence !== null && ` · ${Math.round(r.confidence)}% confidence`}
            </div>
            {r.errorDetail && (
              <div style={{ fontSize: 10.5, marginTop: 3, color: '#FF9C8A' }}>{r.errorDetail}</div>
            )}
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', flexShrink: 0 }}>
            {when(r.at)}
          </div>
        </div>
      ))}
    </div>
  );
}
