'use client';
/**
 * Attach an email to an anonymous account, so a collection outlives the
 * browser it was made in.
 *
 * The app signs everyone in anonymously so nothing blocks a first scan. That
 * account is real and private, but it lives in ONE browser's storage: clearing
 * site data, switching phones, or private browsing loses it, with no warning
 * and no way back. Offering the upgrade is the other half of that decision --
 * without it, "no sign-up needed" quietly means "your collection can vanish".
 *
 * Shown once a collection is worth keeping rather than on first open, because
 * asking for an email before someone has scanned anything is the friction the
 * anonymous session existed to remove.
 */
import { useState } from 'react';
import { supabaseBrowser, SUPABASE_NOT_CONFIGURED } from '@/lib/supabase/browser';

export default function KeepCollection({ cardCount }: { cardCount: number }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (cardCount < 1) return null;

  if (sent) {
    return (
      <p style={{ fontSize: 12.5, color: 'var(--mint)', marginTop: 16 }}>
        Check <strong>{email}</strong> and open the link to finish. Your collection stays
        exactly as it is — the link attaches your email to it.
      </p>
    );
  }

  async function attach(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const sb = supabaseBrowser();
    if (!sb) { setError(SUPABASE_NOT_CONFIGURED); return; }
    setBusy(true);
    // Updates the CURRENT account rather than creating a new one, so the
    // collection carries over untouched. Supabase sends a confirmation link.
    const { error: err } = await sb.auth.updateUser({ email: email.trim() });
    setBusy(false);
    if (err) { setError(err.message); return; }   // rule 4: the provider's own words
    setSent(true);
  }

  return (
    <div style={{
      marginTop: 20, padding: 14, borderRadius: 16,
      background: 'rgba(255,176,32,0.06)', border: '1px solid rgba(255,176,32,0.28)',
    }}>
      <div style={{ fontSize: 12.5, color: 'var(--fg)', fontWeight: 600 }}>
        This collection only exists in this browser
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>
        {cardCount} card{cardCount === 1 ? '' : 's'} saved. Clearing your browser data or
        switching phones would lose them. Add an email and they follow you anywhere —
        still no password.
      </p>

      {!open ? (
        <button onClick={() => setOpen(true)} className="btn-ghost"
                style={{ width: '100%', padding: 11, marginTop: 10, fontSize: 13, cursor: 'pointer' }}>
          Keep my collection
        </button>
      ) : (
        <form onSubmit={attach} style={{ marginTop: 10 }}>
          <input
            type="email" required autoComplete="email" inputMode="email"
            value={email} onChange={(ev) => setEmail(ev.target.value)}
            placeholder="you@example.com"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 14, fontSize: 15,
              background: 'var(--panel)', color: 'var(--fg)', border: '1px solid var(--border)',
            }}
          />
          <button type="submit" className="btn-primary" disabled={busy}
                  style={{ width: '100%', padding: 12, marginTop: 8, fontSize: 14, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Sending…' : 'Send me the link'}
          </button>
        </form>
      )}

      {error && (
        <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12.5, color: '#FF9C8A' }}>{error}</p>
      )}
    </div>
  );
}
