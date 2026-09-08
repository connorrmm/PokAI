'use client';
/**
 * Email and password, as an UPGRADE rather than a gate.
 *
 * Sterling asked for a login. The decision that matters is where it sits: a
 * sign-up wall on first open is the single biggest place people leave an app
 * like this, and "point your phone at a card and it just works" is the whole
 * demo. So scanning still needs nothing. An account is what stops a collection
 * living in one browser's storage -- which is not a hypothetical risk here: on
 * 2026-09-08 three anonymous accounts were created in half an hour and
 * Sterling's four cards ended up split across them, invisible to him.
 *
 * Creating an account UPDATES the anonymous one rather than making a new one,
 * so the collection carries over untouched. That is the difference between an
 * upgrade and a migration, and migrations are where cards go missing.
 */
import { useState } from 'react';
import { supabaseBrowser, SUPABASE_NOT_CONFIGURED } from '@/lib/supabase/browser';
import { captchaToken } from '@/lib/captcha';
import {
  passwordProblem, emailLooksWrong, normaliseEmail, explainAuthError, MIN_PASSWORD,
} from '@/lib/auth';

type Mode = 'create' | 'signin' | 'reset';

const input: React.CSSProperties = {
  width: '100%', padding: '12px 14px', borderRadius: 14, fontSize: 16,
  background: 'var(--panel)', color: 'var(--fg)', border: '1px solid var(--border)',
  marginTop: 8,
};

const notice: React.CSSProperties = {
  fontSize: 12.5, borderRadius: 12, padding: '10px 12px', margin: '10px 0 0',
};

export default function Account({
  isAnonymous, cardCount = 0, onDone,
}: {
  /** True when the current session has no email attached yet. */
  isAnonymous: boolean;
  /** How many cards would come along. Drives the warning below. */
  cardCount?: number;
  onDone?: () => void;
}) {
  // Someone with no email starts on "create"; someone signed out starts on
  // "sign in", because that is what each of them came to do.
  const [mode, setMode] = useState<Mode>(isAnonymous ? 'create' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  /**
   * Signing into an EXISTING account while holding unsaved cards.
   *
   * The anonymous account does not come with you -- it stays behind, holding
   * those cards, and nothing can sign back into it. That is exactly how
   * Sterling lost sight of four cards, so it gets said out loud before it
   * happens rather than discovered afterwards.
   */
  const wouldStrandCards = mode === 'signin' && isAnonymous && cardCount > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const sb = supabaseBrowser();
    if (!sb) { setError(SUPABASE_NOT_CONFIGURED); return; }

    const emailProblem = emailLooksWrong(email);
    if (emailProblem) { setError(emailProblem); return; }
    if (mode !== 'reset') {
      const pwProblem = passwordProblem(password);
      if (pwProblem) { setError(pwProblem); return; }
    }

    setBusy(true);
    try {
      if (mode === 'create') {
        // updateUser, not signUp. signUp would create a SECOND account and
        // leave the collection behind on the first one.
        const { data, error: err } = await sb.auth.updateUser({
          email: normaliseEmail(email),
          password,
        });
        if (err) { setError(explainAuthError(err.message)); return; }

        // Supabase may hold the email as pending until it is confirmed. The
        // password is live immediately either way, so say which state this is
        // rather than a cheerful "done" that is only half true.
        const pending = data.user?.new_email && data.user.new_email !== data.user.email;
        setDone(pending
          ? `Almost there — open the confirmation link we sent to ${normaliseEmail(email)}. `
            + 'Your cards are already safe on this account; confirming is what lets you '
            + 'sign in on another device.'
          : 'Your account is set up. Your collection is attached to it and will follow '
            + 'you to any device you sign in on.');
        onDone?.();
        return;
      }

      if (mode === 'signin') {
        const token = await captchaToken();
        const { error: err } = await sb.auth.signInWithPassword({
          email: normaliseEmail(email),
          password,
          ...(token ? { options: { captchaToken: token } } : {}),
        });
        if (err) { setError(explainAuthError(err.message)); return; }
        onDone?.();
        return;
      }

      const { error: err } = await sb.auth.resetPasswordForEmail(normaliseEmail(email), {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      });
      if (err) { setError(explainAuthError(err.message)); return; }
      // Deliberately the same message whether or not that address has an
      // account. Saying "no account with that email" tells anyone who asks
      // which addresses are registered here.
      setDone(`If ${normaliseEmail(email)} has an account, a reset link is on its way.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p style={{ ...notice, color: 'var(--mint)', background: 'rgba(46,204,150,0.10)',
                  border: '1px solid rgba(46,204,150,0.30)' }}>
        {done}
      </p>
    );
  }

  const heading = mode === 'create'
    ? 'Create an account'
    : mode === 'signin' ? 'Sign in' : 'Reset your password';

  return (
    <form onSubmit={submit}>
      <div className="display" style={{ fontSize: 14, fontWeight: 600 }}>{heading}</div>

      {mode === 'create' && (
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '4px 0 0' }}>
          {cardCount > 0
            ? `Your ${cardCount} card${cardCount === 1 ? '' : 's'} come with you — this adds an `
              + 'email and password to the collection you already have.'
            : 'This adds an email and password so your collection follows you between devices.'}
        </p>
      )}

      <label htmlFor="acct-email" style={{ fontSize: 12.5, color: 'var(--muted)', display: 'block', marginTop: 10 }}>
        Email
      </label>
      <input
        id="acct-email" type="email" required autoComplete="email" inputMode="email"
        value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com" style={input}
      />

      {mode !== 'reset' && (
        <>
          <label htmlFor="acct-password" style={{ fontSize: 12.5, color: 'var(--muted)', display: 'block', marginTop: 10 }}>
            Password{mode === 'create' && ` — at least ${MIN_PASSWORD} characters`}
          </label>
          <input
            id="acct-password" type="password" required
            // Tells a password manager to offer a new one rather than an old.
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'create' ? 'Something you will remember' : ''}
            style={input}
          />
        </>
      )}

      {wouldStrandCards && (
        <p style={{ ...notice, color: 'var(--gold)', background: 'rgba(255,176,32,0.08)',
                    border: '1px solid rgba(255,176,32,0.28)' }}>
          Careful: you have {cardCount} card{cardCount === 1 ? '' : 's'} saved here that are not
          attached to any email yet. Signing into a different account leaves them behind, and
          there is no way back to them. If these are your cards, use{' '}
          <button type="button" onClick={() => { setMode('create'); setError(null); }}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--gold)',
                           textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>
            Create an account
          </button>{' '}instead — it keeps them.
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={busy}
              style={{ width: '100%', padding: 13, marginTop: 12, fontSize: 15,
                       cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Working…'
          : mode === 'create' ? 'Create account'
          : mode === 'signin' ? 'Sign in'
          : 'Email me a reset link'}
      </button>

      {error && (
        <p style={{ ...notice, color: '#FF9C8A', background: 'rgba(232,72,58,0.12)',
                    border: '1px solid rgba(232,72,58,0.35)' }}>
          {error}
        </p>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {mode !== 'create' && (
          <Link onClick={() => { setMode('create'); setError(null); }}>
            {isAnonymous ? 'Create an account instead' : 'Create an account'}
          </Link>
        )}
        {mode !== 'signin' && (
          <Link onClick={() => { setMode('signin'); setError(null); }}>
            I already have an account
          </Link>
        )}
        {mode !== 'reset' && (
          <Link onClick={() => { setMode('reset'); setError(null); }}>
            Forgot your password?
          </Link>
        )}
      </div>
    </form>
  );
}

function Link({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: 12.5,
                     color: 'var(--muted)', textDecoration: 'underline', cursor: 'pointer' }}>
      {children}
    </button>
  );
}
