/**
 * tcgapi.dev client. SERVER ONLY -- this module reads the API key and must
 * never be imported into a client component.
 *
 * Verified against the live API on 2026-08-31:
 *   base    https://api.tcgapi.dev/v1
 *   auth    X-API-Key header
 *   search  GET /v1/search?q=&game=pokemon&limit=
 *   errors  { error: { message, code } }
 *   paging  page / per_page / has_more, per_page max 200
 */
import 'server-only';
import type { ApiCard } from './scanner/types';
import { cacheCards } from './catalog';
import { normaliseCard, type TcgApiCard } from './tcgapi-normalise';

export { normaliseCard };

const BASE = 'https://api.tcgapi.dev/v1';

export class TcgApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'TcgApiError';
  }
}

function apiKey(): string {
  const k = process.env.TCGAPI_KEY;
  if (!k) {
    // Surface the real cause. docs/PRODUCT.md rule 4: show what actually went
    // wrong, never a generic failure -- this project has repeatedly lost time
    // to errors that hid their own reason.
    throw new TcgApiError('TCGAPI_KEY is not set in the server environment', 500, 'missing_key');
  }
  return k;
}

/**
 * Retry with backoff.
 *
 * Ported from the prototype for the same reason it existed there: without it, a
 * single transient failure on the FIRST and best query drops through to
 * progressively weaker fallback guesses, even when a retry would have found the
 * card. Retrying the good query beats trying a worse one.
 */
async function fetchWithRetry(url: string, maxAttempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'X-API-Key': apiKey() },
        signal: AbortSignal.timeout(12_000),
        // Card prices change daily, not per request. Let Vercel cache briefly.
        next: { revalidate: 300 },
      });
      if (res.ok) return res;
      // 4xx other than 429 will not improve by retrying.
      if (res.status !== 429 && res.status < 500) {
        const body = await res.text().catch(() => '');
        throw new TcgApiError(
          `Card database returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
          res.status,
        );
      }
      lastErr = new TcgApiError(`Card database returned ${res.status}`, res.status);
    } catch (e) {
      if (e instanceof TcgApiError && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new TcgApiError('Card database unreachable', 503);
}

export async function searchCards(query: string, limit = 40): Promise<ApiCard[]> {
  const q = query.trim();
  if (!q) return [];
  const url =
    `${BASE}/search?q=${encodeURIComponent(q)}&game=pokemon` +
    `&limit=${Math.min(Math.max(limit, 1), 100)}`;
  const res = await fetchWithRetry(url);
  const json = (await res.json()) as { data?: TcgApiCard[] };
  const cards = Array.isArray(json.data) ? json.data.map(normaliseCard) : [];

  // Fill our own catalog as we go. Every card lookup in the app funnels
  // through here, so doing it at this single point means no future code path
  // can forget to -- and the rows written are the provider's answer to OUR
  // server, never anything a browser supplied. See lib/catalog.ts for why the
  // cache being empty broke saving a card entirely.
  await cacheCards(cards);

  return cards;
}
