'use client';
/**
 * Sign in with an email link.
 *
 * No passwords, deliberately. A password is a thing to store, leak and reset,
 * and this app has no need for one -- proving you can read your email is the
 * same proof a password reset would give anyway. It also means there is no
 * credential in this codebase to get wrong.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabaseBrowser, SUPABASE_NOT_CONFIGURED } from '@/lib/supabase/browser';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) { setReady(true); return; }
    let alive = true;
    sb.auth.getSession()
      .then(({ data }) => {
        if (!alive) return;
        setSession(data.session);
      })
      .catch((e: unknown) => {
        // A rejection here (a navigator-lock timeout, storage blocked by
        // private browsing) used to leave `ready` false forever, so
        // AddToCollection rendered null and the save button simply never
        // appeared -- with nothing on screen to explain why.
        console.warn('Could not read the saved session:', e);
      })
      .finally(() => { if (alive) setReady(true); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const signOut = useCallback(async () => {
    await supabaseBrowser()?.auth.signOut();
  }, []);

  return { session, ready, signOut };
}

export default function Auth({ onDone }: { onDone?: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const sb = supabaseBrowser();
    if (!sb) { setError(SUPABASE_NOT_CONFIGURED); return; }
    setBusy(true);
    const { error: err } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
    });
    setBusy(false);
    // Rule 4: pass the provider's own words through. "Email rate limit
    // exceeded" and "Signups not allowed" need completely different actions,
    // and only the real message distinguishes them.
    if (err) { setError(err.message); return; }
    setSent(true);
    onDone?.();
  }

  if (sent) {
    return (
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
        Check <strong style={{ color: 'var(--fg)' }}>{email}</strong> for a sign-in link.
        Open it on this device — the link signs in the browser it is opened in.
      </p>
    );
  }

  return (
    <form onSubmit={send}>
      <label htmlFor="email" style={{ fontSize: 13, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>
        Your email — we send a link, there is no password
      </label>
      <input
        id="email" type="email" required autoComplete="email" inputMode="email"
        value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        style={{
          width: '100%', padding: '13px 14px', borderRadius: 14, fontSize: 15,
          background: 'var(--panel)', color: 'var(--fg)',
          border: '1px solid var(--border)',
        }}
      />
      <button
        type="submit" className="btn-primary" disabled={busy}
        style={{ width: '100%', padding: 14, fontSize: 15, marginTop: 10, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
      >
        {busy ? 'Sending…' : 'Email me a link'}
      </button>
      {error && (
        <p style={{
          marginTop: 10, marginBottom: 0, fontSize: 13, color: '#FF9C8A',
          background: 'rgba(232,72,58,0.12)', border: '1px solid rgba(232,72,58,0.35)',
          borderRadius: 12, padding: '10px 12px',
        }}>
          {error}
        </p>
      )}
    </form>
  );
}
