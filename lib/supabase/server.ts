import 'server-only';
/**
 * Supabase on the server, in two distinct roles. Keeping them apart is the
 * whole point of this file.
 *
 * `asUser` acts AS THE SIGNED-IN PERSON, using the anon key plus their access
 * token, so row-level security applies exactly as it does in the browser. A
 * bug here can only ever expose that user's own rows.
 *
 * `admin` uses the service_role key, which BYPASSES row-level security
 * entirely. It exists for one reason: the card catalog is server-only for
 * licence compliance (migration 0004), so something has to read it. It must
 * never be used to read user data -- that is what asUser is for, and mixing
 * them is how one person ends up seeing another's collection.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The build-time snapshot of the variables we need.
 *
 * There are two ways to read the environment in Next.js and they do NOT return
 * the same thing. A STATIC `process.env.NAME` is textually replaced by its
 * value when the app is built. A DYNAMIC `process.env[name]` is left alone and
 * reads whatever the server actually has when the request runs.
 *
 * Both can be empty for different reasons -- a build without the variable
 * present bakes in nothing; a runtime without it exported reads nothing -- and
 * chasing which of the two was empty cost this project real days. So read both
 * and prefer the runtime one, which is the value that is current if a key was
 * ever rotated. Listing the names here is the price: a static read only works
 * on a literal name, so it cannot be written as a loop.
 */
const AT_BUILD: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
};

function env(name: string): string | null {
  const runtime = process.env[name];
  const v = runtime && runtime.trim() ? runtime : AT_BUILD[name];
  return v && v.trim() ? v.trim() : null;
}

/** Where each variable was found, for diagnostics. Never a value. */
export function envSources(): Record<string, 'runtime' | 'build' | 'absent'> {
  const names = Object.keys(AT_BUILD);
  const out: Record<string, 'runtime' | 'build' | 'absent'> = {};
  for (const n of names) {
    const runtime = process.env[n];
    const build = AT_BUILD[n];
    out[n] = runtime && runtime.trim() ? 'runtime' : (build && build.trim() ? 'build' : 'absent');
  }
  return out;
}

/**
 * A client scoped to one user by their access token. RLS applies.
 * Returns null when Supabase is unconfigured so callers can report it.
 */
export function asUser(accessToken: string): SupabaseClient | null {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Service-role client. Bypasses RLS. Catalog reads only.
 */
export function admin(): SupabaseClient | null {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY');
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Which Supabase variables are missing, by name.
 *
 * Rule 4, applied to our own error messages: listing all three and letting the
 * reader work out which one is absent is a generic failure wearing a helpful
 * costume. Names only -- never a value, since two of these are secrets.
 */
export function missingSupabaseEnv(): string[] {
  const missing: string[] = [];
  if (!env('NEXT_PUBLIC_SUPABASE_URL')) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!env('NEXT_PUBLIC_SUPABASE_ANON_KEY')) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!env('SUPABASE_SERVICE_ROLE_KEY') && !env('SUPABASE_SECRET_KEY')) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  return missing;
}

/** Pull a bearer token off a request, or null. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Does the service-role key actually WORK?
 *
 * "Set" and "works" are different facts, and health only ever reported the
 * first. On 2026-09-08 a key was present, so every check said configured, and
 * Supabase answered every catalog read with "Invalid API key" -- most likely a
 * key that had been rotated in Supabase while Vercel still held the old one.
 * Presence cannot see that. Only a real query can.
 *
 * Reads one id from the catalog: the cheapest query that still proves the key
 * is accepted and the table is reachable. Reports the provider's own message,
 * never a key.
 */
export async function serviceRoleCheck(): Promise<{ ok: boolean; detail: string; cardsCached?: number }> {
  const sb = admin();
  if (!sb) {
    return { ok: false, detail: 'No key is set. Add SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy.' };
  }
  try {
    const { count, error } = await sb.from('cards').select('id', { count: 'exact', head: true });
    if (error) {
      // supabase-js reports a rejected key and an unreachable host through the
      // same shape, and a network failure often arrives with an EMPTY message.
      // Quoting that verbatim produces `rejected it: ""`, which is rule 4's
      // generic failure wearing a quotation mark. Say which kind it is.
      const why = [error.message, error.details, error.hint, error.code]
        .filter((v) => typeof v === 'string' && v.trim())
        .join(' — ');
      const unreachable = !why || /fetch|network|ENOTFOUND|ECONN|timeout|allowlist/i.test(why);
      return {
        ok: false,
        detail: unreachable
          ? `Could not reach Supabase to check the key${why ? `: ${why}` : ' (the request failed with no message)'}. `
            + 'This does not say whether the key is right -- only that the check could not run.'
          : `A key IS set, but Supabase rejected it: "${why}". This is a wrong or rotated `
            + 'value, not a missing one. Copy the current service_role / secret key from '
            + 'Supabase into the SAME variable in Vercel and redeploy.',
      };
    }
    return { ok: true, detail: 'Key accepted by Supabase.', cardsCached: count ?? 0 };
  } catch (e) {
    return { ok: false, detail: `Could not reach Supabase: ${e instanceof Error ? e.message : String(e)}` };
  }
}
