/**
 * One anonymous account per person, not one per component.
 *
 * THE BUG THIS PINS. Five components call useSession() independently, and
 * several mount together. Each ran the same effect, each found no stored
 * session, and each created its own anonymous account. The last to finish won
 * the browser's storage and the others became accounts nobody could ever sign
 * back into.
 *
 * Row-level security then did exactly what it should, which is what made it so
 * quiet: a card saved with a losing account's token belongs to that account and
 * is simply absent from the user's view. Sterling's live database on 2026-09-08
 * held THREE anonymous users created within thirty minutes, his cards split
 * across them, while the app told him he had one card.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/browser', () => ({
  supabaseBrowser: () => null,
  SUPABASE_NOT_CONFIGURED: 'not configured',
}));
vi.mock('@/lib/captcha', () => ({ captchaToken: async () => null }));

/** A Supabase auth client with only the calls ensureSession makes. */
function fakeClient(opts: { stored?: unknown; fail?: string } = {}) {
  let signIns = 0;
  return {
    signIns: () => signIns,
    auth: {
      getSession: async () => ({ data: { session: opts.stored ?? null } }),
      signInAnonymously: async () => {
        signIns += 1;
        // A real network round trip. The race lives entirely inside this gap.
        await new Promise((r) => setTimeout(r, 10));
        if (opts.fail) return { data: { session: null }, error: new Error(opts.fail) };
        return { data: { session: { access_token: `token-${signIns}` } }, error: null };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  };
}

beforeEach(() => vi.resetModules());

describe('ensureSession', () => {
  it('creates ONE account when five components ask at once', async () => {
    const { ensureSession } = await import('@/components/Auth');
    const sb = fakeClient();
    const sessions = await Promise.all(
      Array.from({ length: 5 }, () => ensureSession(sb as never)),
    );
    expect(sb.signIns()).toBe(1);
    // And everyone got the same one, so every component saves to one account.
    const tokens = new Set(sessions.map((s) => (s as { access_token: string }).access_token));
    expect(tokens).toEqual(new Set(['token-1']));
  });

  it('never signs in when a session is already stored', async () => {
    const { ensureSession } = await import('@/components/Auth');
    const sb = fakeClient({ stored: { access_token: 'existing' } });
    await Promise.all([ensureSession(sb as never), ensureSession(sb as never)]);
    expect(sb.signIns()).toBe(0);
  });

  it('lets a later mount retry after a failure', async () => {
    // A rejected promise kept forever would mean one bad moment at startup
    // left the app permanently unable to sign anyone in.
    const { ensureSession } = await import('@/components/Auth');
    const failing = fakeClient({ fail: 'Anonymous sign-ins are disabled' });
    await expect(ensureSession(failing as never)).rejects.toThrow('Anonymous sign-ins are disabled');

    const working = fakeClient();
    await expect(ensureSession(working as never)).resolves.toMatchObject({ access_token: 'token-1' });
    expect(working.signIns()).toBe(1);
  });
});

/**
 * The lock has to survive a second copy of the module.
 *
 * Module state is per module INSTANCE. A bundler may hand two chunks their own
 * copy, and a module-level singleton then quietly becomes two singletons. In
 * production the burst of accounts per page load fell from six to two rather
 * than to one, which is what that looks like from the outside.
 */
describe('ensureSession across module copies', () => {
  it('shares one sign-in with a second copy of the module on the same page', async () => {
    const g = globalThis as unknown as { window?: unknown };
    const hadWindow = 'window' in g;
    g.window = g.window ?? {};
    try {
      const sb = fakeClient();
      vi.resetModules();
      const a = await import('@/components/Auth');
      vi.resetModules();               // a genuinely separate module instance
      const b = await import('@/components/Auth');
      expect(a).not.toBe(b);

      await Promise.all([a.ensureSession(sb as never), b.ensureSession(sb as never)]);
      expect(sb.signIns()).toBe(1);
    } finally {
      if (!hadWindow) delete g.window;
    }
  });

  it('does not sign in again when another tab got there first', async () => {
    // Two tabs cannot share a promise, but they do share storage. Looking once
    // more after the captcha wait is what catches that.
    const g = globalThis as unknown as { window?: unknown };
    const hadWindow = 'window' in g;
    g.window = g.window ?? {};
    try {
      let stored: unknown = null;
      let signIns = 0;
      const sb = {
        auth: {
          getSession: async () => {
            const s = stored;
            // The other tab finishes while we are waiting on the captcha.
            stored = { access_token: 'from-the-other-tab' };
            return { data: { session: s } };
          },
          signInAnonymously: async () => { signIns += 1; return { data: { session: {} }, error: null }; },
        },
      };
      vi.resetModules();
      const { ensureSession } = await import('@/components/Auth');
      const session = await ensureSession(sb as never);
      expect(signIns).toBe(0);
      expect(session).toMatchObject({ access_token: 'from-the-other-tab' });
    } finally {
      if (!hadWindow) delete g.window;
    }
  });
});

/**
 * The cross-tab lock.
 *
 * The page-scoped promise stops components on ONE page racing. It cannot stop
 * two tabs, or a reload that starts before the previous page wrote its session
 * to storage -- and production showed accounts still being created in pairs
 * milliseconds apart after the page fix. Both readings of that (a broken lock,
 * or a lost session) are closed by serialising the one irreversible step.
 */
describe('account creation is serialised across tabs', () => {
  // globalThis.navigator is read-only in Node, so it is stubbed rather than
  // assigned. window has to exist too: the page-scoped lock reads it.
  function withNavigator(locks: unknown) {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', locks === undefined ? {} : { locks });
    return () => vi.unstubAllGlobals();
  }

  it('takes the lock before creating an account', async () => {
    const taken: string[] = [];
    const restore = withNavigator({
      request: async (name: string, fn: () => Promise<unknown>) => { taken.push(name); return fn(); },
    });
    try {
      vi.resetModules();
      const { ensureSession } = await import('@/components/Auth');
      const sb = fakeClient();
      await ensureSession(sb as never);
      expect(taken).toEqual(['pokai-anonymous-sign-in']);
      expect(sb.signIns()).toBe(1);
    } finally { restore(); }
  });

  it('does not take the lock when a session already exists', async () => {
    // Waiting on a lock we do not need would make every page load slower for
    // the common case, which is a returning visitor.
    const taken: string[] = [];
    const restore = withNavigator({
      request: async (name: string, fn: () => Promise<unknown>) => { taken.push(name); return fn(); },
    });
    try {
      vi.resetModules();
      const { ensureSession } = await import('@/components/Auth');
      const sb = fakeClient({ stored: { access_token: 'existing' } });
      await ensureSession(sb as never);
      expect(taken).toEqual([]);
      expect(sb.signIns()).toBe(0);
    } finally { restore(); }
  });

  it('still signs in on a browser with no Web Locks', async () => {
    // Older Safari. An unlocked attempt is exactly what we had before, so the
    // fallback can only ever be an improvement, never a regression.
    const restore = withNavigator(undefined);
    try {
      vi.resetModules();
      const { ensureSession } = await import('@/components/Auth');
      const sb = fakeClient();
      await expect(ensureSession(sb as never)).resolves.toBeTruthy();
      expect(sb.signIns()).toBe(1);
    } finally { restore(); }
  });
});
