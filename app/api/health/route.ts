import { NextResponse } from 'next/server';

/** Cheap liveness check that also reports which server config is present.
 *  Reports presence only -- never the values. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    time: new Date().toISOString(),
    config: {
      tcgapi_key: Boolean(process.env.TCGAPI_KEY),
      supabase_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      supabase_service_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      anthropic_key: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  });
}
