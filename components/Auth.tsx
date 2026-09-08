'use client';
/**
 * The session: who the app is acting as, and how exactly one of them gets made.
 *
 * The sign-in FORM lives in Account.tsx. This file is only about establishing a
 * session, which is a different job and the one that has caused real damage
 * when it went wrong.
 *
 * An earlier version offered an email link and no password at all, on the
 * reasoning that proving you can read your email is the same proof a password
 * reset gives. Sterling asked for a username and password, which is what people
 * expect and what a partner evaluating the product expects to see. The reset
 * flow in Account.tsx is that email proof, kept for the case it was always
 * best at: getting back in when the password is gone.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/browser';
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

/**
 * A random id for THIS page load, stamped onto any account created from it.
 *
 * Production kept creating anonymous accounts in pairs, milliseconds apart,
 * after a fix that should have made that impossible. Two readings fit equally
 * well from the outside -- one page load signing in twice (the lock is broken)
 * or two page loads signing in once each (the lock is fine and the stored
 * session is being lost) -- and they have completely different fixes.
 *
 * Guessing between them has already cost this project several rounds today. So
 * the account records which page load made it, and the database answers the
 * question instead of me: two accounts sharing a page id means the lock failed.
 * Different ids mean the session is not surviving between loads.
 *
 * A random string, no personal data, and Supabase keeps it in the user's own
 * metadata.
 */
const PAGE_ID = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID().slice(0, 8)
  : Math.random().toString(36).slice(2, 10);
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


/**
 * Serialise account creation ACROSS TABS, not just within one page.
 *
 * The page-scoped promise stops five components on one page racing each other.
 * It cannot stop two tabs, or a reload that begins before the previous page
 * finished writing its session to storage -- and those produce exactly the same
 * symptom: two anonymous accounts moments apart, one of them holding cards
 * nobody can ever sign back into.
 *
 * The Web Locks API is the browser's own answer to this and is held per origin,
 * so a second tab waits rather than racing. Where it does not exist (older
 * Safari) the work still runs -- an unlocked attempt is what we had before, so
 * this can only ever be an improvement, never a regression.
 */
async function withSignInLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { locks?: LockManager }).locks
    : undefined;
  if (!locks?.request) return work();
  return locks.request('pokai-anonymous-sign-in', work);
}

/**
 * Create the anonymous account. Called only while the lock is held.
 *
 * Checks for a stored session ONE more time first, because the tab that held
 * the lock before us may have just created one -- which is the entire point of
 * waiting for the lock rather than proceeding in parallel.
 */
async function createAnonymous(
  sb: NonNullable<ReturnType<typeof supabaseBrowser>>,
): Promise<Session | null> {

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

  const { data: anon, error } = await sb.auth.signInAnonymously({
    options: {
      ...(token ? { captchaToken: token } : {}),
      // Which page load created this account. See PAGE_ID above -- it is the
      // difference between a broken lock and a lost session, and it is not
      // answerable from the outside without it.
      data: { created_by_page: PAGE_ID },
    },
  });
  if (error) {
    // Rule 4: pass the real reason through. "Anonymous sign-ins are
    // disabled" is a switch in the Supabase dashboard, and no amount of
    // retrying fixes it -- but the message names it exactly.
    throw error;
  }
  return anon.session;
}

export function ensureSession(sb: NonNullable<ReturnType<typeof supabaseBrowser>>): Promise<Session | null> {
  const existing = held();
  if (existing) return existing;
  const started = (async () => {
    const { data } = await sb.auth.getSession();
    if (data.session) return data.session;

    // Beyond this point we are about to CREATE an account, which is the only
    // irreversible thing this function does. Everything below runs inside a
    // cross-tab lock.
    return withSignInLock(() => createAnonymous(sb));
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

  return {
    session, ready, signOut, signInError,
    isAnonymous: session?.user?.is_anonymous === true,
    // Null while anonymous. What the account bar shows once there is one.
    email: session?.user?.email ?? null,
  };
}
