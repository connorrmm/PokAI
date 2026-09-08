/**
 * Tests for how the server reads its own configuration.
 *
 * These exist because of a specific, expensive failure. For days the portfolio
 * answered "This deployment is missing SUPABASE_SERVICE_ROLE_KEY" while the
 * health endpoint insisted every variable was set. Three different explanations
 * were offered and two of them were wrong, because nothing here was pinned
 * down: which variable each client actually needs, and what a missing one is
 * allowed to break.
 *
 * The rule these lock in: the service-role key is for the CARD CATALOG only.
 * A collection is the user's own rows, read as the user. So a missing
 * service-role key may cost prices and card art -- it must never cost someone
 * their collection, and it must never turn the portfolio into an error page.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const NAMES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
] as const;

/**
 * Load lib/supabase/server.ts fresh with exactly this environment.
 *
 * Fresh matters: the module snapshots the build-time values when it is first
 * imported, so a module left over from a previous test would answer with that
 * test's environment and quietly prove nothing.
 */
async function loadWith(env: Partial<Record<(typeof NAMES)[number], string>>) {
  vi.resetModules();
  for (const n of NAMES) {
    if (env[n] === undefined) delete process.env[n];
    else process.env[n] = env[n];
  }
  return import('../lib/supabase/server');
}

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const n of NAMES) original[n] = process.env[n];
});

afterEach(() => {
  for (const n of NAMES) {
    if (original[n] === undefined) delete process.env[n];
    else process.env[n] = original[n];
  }
  vi.resetModules();
});

const URL_ = 'https://yycsgtsvkhguzihyxtur.supabase.co';
const ANON = 'anon-key-for-tests';

describe('what each Supabase client actually requires', () => {
  it('gives a user client with only the url and the anon key', async () => {
    const { asUser } = await loadWith({ NEXT_PUBLIC_SUPABASE_URL: URL_, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON });
    // If this were ever null, every route would answer notConfigured() and the
    // portfolio would be an error page -- which is exactly what happened.
    expect(asUser('some-access-token')).not.toBeNull();
  });

  it('still gives a user client when the service-role key is absent', async () => {
    const { asUser, admin } = await loadWith({
      NEXT_PUBLIC_SUPABASE_URL: URL_, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
    });
    expect(admin()).toBeNull();          // no catalog: prices and art unavailable
    expect(asUser('token')).not.toBeNull(); // but the collection still loads
  });

  it('has no user client without the anon key, and says so by name', async () => {
    const { asUser, missingSupabaseEnv } = await loadWith({ NEXT_PUBLIC_SUPABASE_URL: URL_ });
    expect(asUser('token')).toBeNull();
    expect(missingSupabaseEnv()).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  });

  it('accepts SUPABASE_SECRET_KEY as the service-role key', async () => {
    // Supabase issues these as `sb_secret_...` under the newer name. Treating
    // that as missing sends someone hunting for a key that is already there.
    const { admin, missingSupabaseEnv } = await loadWith({
      NEXT_PUBLIC_SUPABASE_URL: URL_, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
      SUPABASE_SECRET_KEY: 'sb_secret_example',
    });
    expect(admin()).not.toBeNull();
    expect(missingSupabaseEnv()).toEqual([]);
  });

  it('treats a whitespace-only value as absent', async () => {
    // A copy-paste that picked up a newline reads as "set" to a Boolean check
    // and fails at the API with an opaque 401. Better to name it missing.
    const { admin, missingSupabaseEnv } = await loadWith({
      NEXT_PUBLIC_SUPABASE_URL: URL_, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
      SUPABASE_SERVICE_ROLE_KEY: '   ',
    });
    expect(admin()).toBeNull();
    expect(missingSupabaseEnv()).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
  });
});

describe('the diagnostic reports where a value came from', () => {
  it('says runtime for a value the server process has', async () => {
    const { envSources } = await loadWith({
      NEXT_PUBLIC_SUPABASE_URL: URL_, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
    });
    expect(envSources().NEXT_PUBLIC_SUPABASE_URL).toBe('runtime');
    expect(envSources().SUPABASE_SERVICE_ROLE_KEY).toBe('absent');
  });

  it('never reports a value, only where it was found', async () => {
    const { envSources } = await loadWith({
      NEXT_PUBLIC_SUPABASE_URL: URL_, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
      SUPABASE_SECRET_KEY: 'sb_secret_do_not_leak_me',
    });
    const serialized = JSON.stringify(envSources());
    expect(serialized).not.toContain('sb_secret_do_not_leak_me');
    expect(serialized).not.toContain(ANON);
  });
});
