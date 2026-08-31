import { NextResponse } from 'next/server';
import { searchCards, TcgApiError } from '@/lib/tcgapi';
import { rateLimit, clientKey } from '@/lib/rate-limit';

/**
 * Card search. The browser calls this; this calls tcgapi.dev.
 *
 * The API key lives only here. That is what keeps it out of a public repo, and
 * it is the arrangement tcgapi.dev's licence explicitly blesses: "keeping your
 * API key server-side and proxying data to your own app's users is normal
 * architecture, not redistribution."
 *
 * What would NOT be allowed is letting this become a general-purpose public
 * price API, so it is rate limited, capped, and must require a session once
 * accounts exist. There must never be a bulk export route.
 */
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();

  if (!q) {
    return NextResponse.json({ error: { message: 'Missing ?q=', code: 'bad_request' } }, { status: 400 });
  }
  if (q.length > 100) {
    return NextResponse.json({ error: { message: 'Query too long', code: 'bad_request' } }, { status: 400 });
  }

  const limit = Math.min(Number(searchParams.get('limit') || 40) || 40, 100);

  const rl = rateLimit(clientKey(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { message: 'Too many requests. Please slow down.', code: 'rate_limited' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const data = await searchCards(q, limit);
    return NextResponse.json({ data });
  } catch (e) {
    // Rule 4: show the real error. A generic "something went wrong" is what
    // made this app undebuggable before.
    const isApiErr = e instanceof TcgApiError;
    const status = isApiErr ? (e.status >= 500 ? 502 : e.status) : 500;
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('[/api/search] failed:', message);
    return NextResponse.json(
      { error: { message, code: isApiErr ? e.code ?? 'upstream_error' : 'internal_error' } },
      { status },
    );
  }
}
