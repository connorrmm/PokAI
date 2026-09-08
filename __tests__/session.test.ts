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
