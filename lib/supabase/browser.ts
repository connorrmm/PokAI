'use client';
/**
 * Supabase in the browser. Authentication ONLY.
 *
 * The browser never reads card data from Supabase, and cannot: migration 0004
 * revoked catalog access from the anon and authenticated roles because
 * tcgapi.dev's licence forbids serving their records onward. Card names and
 * prices come from our own API, which reads them server-side.
 *
 * What this client is for is the user's session -- signing in, and holding the
 * access token that our API uses to act as them.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/** Null when Supabase is not configured, so callers can say so rather than crash. */
export function supabaseBrowser(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return cached;
}

/** The message to show when sign-in cannot work at all, per rule 4. */
export const SUPABASE_NOT_CONFIGURED =
  'Sign-in is not available because this deployment has no Supabase keys. ' +
  'Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel → ' +
  'Settings → Environment Variables, then redeploy.';
