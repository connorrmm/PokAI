import { NextResponse } from 'next/server';

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
  ];

  const missingRequired = vars.filter((v) => v.required && !v.set).map((v) => v.name);

  return NextResponse.json({
    ok: missingRequired.length === 0,
    time: new Date().toISOString(),
    summary: missingRequired.length === 0
      ? 'All required configuration is present.'
      : `Missing required configuration: ${missingRequired.join(', ')}. Set it in Vercel > Settings > Environment Variables, then redeploy.`,
    config: vars,
  });
}
