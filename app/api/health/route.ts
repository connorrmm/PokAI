import { NextResponse } from 'next/server';
import { missingSupabaseEnv, envSources } from '@/lib/supabase/server';

/**
 * Liveness check that also reports server configuration.
 *
 * Reports PRESENCE only, never values.
 *
 * It also says whether each variable is actually needed *yet*. An earlier
 * version listed four variables as bare true/false, which read as "four things
 * are misconfigured" when only one was in use -- a health check that creates
 * false alarms is worse than none, because it trains you to ignore it.
 */
export async function GET() {
  const vars = [
    {
      name: 'TCGAPI_KEY',
      set: Boolean(process.env.TCGAPI_KEY),
      required: true,
      used_for: 'Card search and prices. Without it, /api/search fails and the scanner has no card database.',
    },
    {
      name: 'ANTHROPIC_API_KEY',
      set: Boolean(process.env.ANTHROPIC_API_KEY),
      required: true,
      used_for: 'Vision-model card recognition - the primary scanner. Without it, scanning falls back to on-device OCR, which reads real-world photos poorly.',
    },
    {
      name: 'NEXT_PUBLIC_SUPABASE_URL',
      set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      required: false,
      used_for: 'Sign-in and saved collections. Without it, scanning still works but nothing can be kept.',
    },
    {
      name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      required: false,
      used_for: 'Sign-in in the browser, and the token our API uses to act as that user so row-level security applies. Public by design - it is safe in client code, unlike the service role key.',
    },
    {
      name: 'SUPABASE_SERVICE_ROLE_KEY',
      // Supabase now issues these as `sb_secret_...` under the name
      // SUPABASE_SECRET_KEY. Either satisfies the server, so either counts
      // here -- reporting "missing" for a key that is present under its other
      // name sends someone hunting for a problem that is not there.
      set: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
      required: false,
      used_for: 'Reading card names, art and prices for a collection. The catalog is server-only for licence compliance, so only the server may read it. NEVER put this in client code - it bypasses row-level security entirely.',
    },
    {
      name: 'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
      set: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
      required: false,
      used_for: 'Cloudflare Turnstile, which stops a script mass-creating anonymous accounts to spend the scanning budget. Public by design. Until it is set the captcha code is inert and sign-in behaves as before; it must be set here AND the secret added in Supabase for protection to actually apply.',
    },
  ];

  // Names that LOOK like one of ours but are not exactly one of ours.
  //
  // A variable set as SUPABASE_SERVICE_ROLE (no _KEY), or with a trailing
  // space, or under a different spelling, reports as simply "not set" and
  // sends someone hunting through a dashboard for something that is right
  // there under the wrong name. Names only -- never a value, since these are
  // the secrets.
  const known = new Set(vars.map((v) => v.name).concat(['SUPABASE_SECRET_KEY']));

  /**
   * A name that is itself a credential, masked.
   *
   * The first attempt at this reported nothing useful, because it only looked
   * for names mentioning a service. The actual mistake was a variable whose
   * NAME was the key and whose value was something else entirely -- and
   * `sb_secret_...` contains none of those words, so the check that was meant
   * to catch exactly this could not see it.
   *
   * Masked because the whole problem is that a secret ended up in a name
   * field, and echoing it into a public health endpoint would publish it.
   */
  const CREDENTIAL_SHAPED = /^(sb_secret_|sb_publishable_|sk_live_|sk_test_|sk-ant-|tcg_live_|eyJ|service_role)/i;
  const mask = (k: string) =>
    `${k.slice(0, Math.min(10, k.length))}…(${k.length} chars, looks like a key in the NAME field)`;

  const lookalikes = Object.keys(process.env)
    .filter((k) => !known.has(k))
    .filter((k) => /supabase|turnstile|tcgapi|anthropic/i.test(k) || CREDENTIAL_SHAPED.test(k))
    .map((k) => (CREDENTIAL_SHAPED.test(k) ? mask(k) : k))
    .sort();

  const missingRequired = vars.filter((v) => v.required && !v.set).map((v) => v.name);

  return NextResponse.json({
    ok: missingRequired.length === 0,
    time: new Date().toISOString(),
    summary: missingRequired.length === 0
      ? 'All required configuration is present.'
      : `Missing required configuration: ${missingRequired.join(', ')}. Set it in Vercel > Settings > Environment Variables, then redeploy.`,
    config: vars,
    /**
     * The same variables read the way the APP reads them.
     *
     * The `config` list above uses static `process.env.NAME` lookups, which
     * Next.js REPLACES AT BUILD TIME. Everything in lib/supabase/server.ts
     * uses a dynamic `process.env[name]` lookup, which cannot be replaced and
     * so reads the real runtime environment.
     *
     * The two can therefore disagree, and when they do, `config` is the
     * optimistic one -- it can report a variable as present that the running
     * app cannot actually see. This field is what the app sees. If a name
     * appears here while `config` says it is set, that gap IS the bug.
     */
    missing_at_runtime: missingSupabaseEnv(),
    /**
     * Where each Supabase variable was actually found: "runtime" (the server
     * process has it), "build" (only the value baked in when this deployment
     * was built), or "absent" (neither). A key that reads "build" still works,
     * but it is the value from build time -- so if it was rotated afterwards,
     * this deployment is using the old one and needs a rebuild.
     */
    env_source: envSources(),
    // Empty is the normal case. Anything here is almost certainly the
    // variable you think you set, under a name the app is not reading.
    unexpected_names: lookalikes,
  });
}
