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

function env(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
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

/** Pull a bearer token off a request, or null. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
