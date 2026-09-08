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
import { captchaToken } from '@/lib/captcha';

/**
 * The ONE anonymous sign-in, shared by every component that needs a session.
 *
 * WHY THIS IS A MODULE-LEVEL SINGLETON. Five components call useSession()
 * independently -- Scanner, AddToCollection, Portfolio, Collection, History --
 * and several of them mount together. Each ran this effect, each found no
 * stored session, and each created its own anonymous account. Last one to
 * finish won the browser's storage; the rest became accounts nobody could sign
 * back into.
 *
 * That is not a cosmetic race. Row-level security is doing its job, so a card
 * saved with the losing account's token is that account's card, and it is
 * simply gone from the user's view. Sterling's live database on 2026-09-08 had
 * THREE anonymous users created inside thirty minutes with his cards split
 * across them -- three cards under one, one under another -- and the app showed
 * him "1 card" while the first three sat there unreachable.
 *
 * A promise, not a boolean: the window that matters is between starting the
 * sign-in and finishing it, which is exactly when a flag has not been set yet.
 * Everyone awaits the same promise, so there is exactly one sign-in.
 */
/**
 * Held on the page itself, not just in this module.
 *
 * Module state is per module INSTANCE, and a bundler is free to give two
 * chunks their own copy -- at which point a module-level singleton silently
 * becomes two singletons. The page is the thing there is exactly one of, so
 * the lock lives there. Production bore this out: the burst of new accounts
 * per page load fell from six to two, not to one.
 */
const LOCK = '__pokaiSession';
type LockHolder = { [LOCK]?: Promise<Session | null> | null };

function held(): Promise<Session | null> | null | undefined {
  return typeof window === 'undefined' ? bootstrap : (window as unknown as LockHolder)[LOCK];
}
function hold(p: Promise<Session | null> | null) {
  bootstrap = p;
  if (typeof window !== 'undefined') (window as unknown as LockHolder)[LOCK] = p;
}

/** Server-side fallback for the lock, and what the tests read. */
let bootstrap: Promise<Session | null> | null = null;

export function ensureSession(sb: NonNullable<ReturnType<typeof supabaseBrowser>>): Promise<Session | null> {
  const existing = held();
  if (existing) return existing;
  const started = (async () => {
    const { data } = await sb.auth.getSession();
    if (data.session) return data.session;

    // No session: make one WITHOUT asking for anything.
    //
    // Sterling: "instead of needing to send an email to yourself, people
    // just want to see it when they pull up the app." An anonymous account
    // is a real account -- row-level security applies to it exactly as to
    // any other, so a collection is private from the first scan -- it just
    // has no email attached yet. Adding an email later keeps the same
    // account and carries the collection to other devices.
    //
    // The alternative was storing collections in the browser, which loses
    // everything the moment someone clears their data. A collection that
    // can evaporate is worse than one that needs an account.
    // Supabase applies CAPTCHA protection to sign-ins, anonymous ones
    // included. Resolves null until a sitekey is configured, so this is a
    // no-op today and correct the moment one is added.
    const token = await captchaToken();

    // Look once more. Another tab may have signed in and written the session
    // to shared storage while we were waiting on the captcha -- a promise can
    // only deduplicate within one page, and storage is what the tabs share.
    const { data: again } = await sb.auth.getSession();
    if (again.session) return again.session;

    const { data: anon, error } = await sb.auth.signInAnonymously(
      token ? { options: { captchaToken: token } } : undefined,
    );
    if (error) {
      // Rule 4: pass the real reason through. "Anonymous sign-ins are
      // disabled" is a switch in the Supabase dashboard, and no amount of
      // retrying fixes it -- but the message names it exactly.
      throw error;
    }
    return anon.session;
  })();

  hold(started);
  // Clear on failure so a later mount can try again. Keeping a rejected
  // promise would mean one bad moment at startup left the app permanently
  // unable to sign anyone in.
  started.catch(() => hold(null));
  return started;
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) { setReady(true); return; }
    let alive = true;
    ensureSession(sb)
      .then((s) => { if (alive) setSession(s); })
      .catch((e: unknown) => {
        if (!alive) return;
        // A rejection here (a navigator-lock timeout, storage blocked by
        // private browsing, anonymous sign-ins switched off) used to leave
        // `ready` false forever, so AddToCollection rendered null and the save
        // button simply never appeared -- with nothing on screen to say why.
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('Could not establish a session:', msg);
        setSignInError(msg);
      })
      .finally(() => { if (alive) setReady(true); });
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      // Signing out must also drop the shared promise. Without this,
      // ensureSession would hand the next mount the session that was just
      // signed out of.
      if (event === 'SIGNED_OUT') hold(null);
      setSession(s);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const signOut = useCallback(async () => {
    hold(null);
    await supabaseBrowser()?.auth.signOut();
  }, []);

  return { session, ready, signOut, signInError, isAnonymous: session?.user?.is_anonymous === true };
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
    // A token is single-use, so the email path fetches its own.
    const token = await captchaToken();
    const { error: err } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        ...(token ? { captchaToken: token } : {}),
      },
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
