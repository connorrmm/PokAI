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
import { cacheCards, type CacheResult } from './catalog';
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

/**
 * How the most recent catalog write went, for diagnostics.
 *
 * Module-level rather than threaded through every return type, because
 * searchCards' signature is used in several places and this is a debugging
 * aid, not part of the contract. Serverless instances handle one request at a
 * time, so this cannot bleed between users' requests.
 */
let lastCacheResult: CacheResult | null = null;
export function lastCatalogWrite(): CacheResult | null { return lastCacheResult; }

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
  lastCacheResult = await cacheCards(cards);

  return cards;
}

/**
 * Cards by id, straight from the provider.
 *
 * WHY THIS EXISTS. The catalog cache is filled by `searchCards`, so a card only
 * ever gets a cached price if someone searched for it while the service-role
 * key was readable. On 2026-09-08 the live database held three saved cards and
 * ZERO catalog rows, so the portfolio showed the cards with no value against
 * any of them -- correct behaviour (rule 2 forbids inventing a price) answering
 * a question nobody wanted asked.
 *
 * A portfolio must be able to price what it holds without waiting for someone
 * to search for it again. So the cache becomes an optimisation rather than a
 * requirement: if it has the price, use it; if not, ask the provider.
 *
 * `GET /v1/cards/{id}` is documented (docs/CATALOG.md) but, unlike /v1/search,
 * has never returned a verified 200 to us -- this sandbox cannot reach the
 * host. So it is written to tolerate a bare card object or a `{data: ...}`
 * wrapper, and anything it does not recognise is reported as a failure rather
 * than silently becoming a card with no price. A wrong price is far worse than
 * a missing one.
 */
export interface CardRef {
  id: number;
  /** The name the user's own collection row remembers, for the fallback. */
  name?: string | null;
  number?: string | null;
}

export async function cardsByIds(refs: CardRef[]): Promise<{ cards: ApiCard[]; errors: string[] }> {
  const byId = new Map<number, CardRef>();
  for (const r of refs) {
    if (Number.isFinite(r.id) && r.id > 0 && !byId.has(r.id)) byId.set(r.id, r);
  }
  const unique = [...byId.keys()];
  if (!unique.length) return { cards: [], errors: [] };

  const cards: ApiCard[] = [];
  const errors: string[] = [];

  // In small batches: a collection of two hundred cards must not open two
  // hundred sockets at once, and the provider rate-limits.
  const BATCH = 6;
  for (let i = 0; i < unique.length; i += BATCH) {
    const results = await Promise.all(unique.slice(i, i + BATCH).map(async (id) => {
      try {
        const res = await fetchWithRetry(`${BASE}/cards/${id}`);
        const json: unknown = await res.json();
        const raw = (json && typeof json === 'object' && 'data' in (json as Record<string, unknown>))
          ? (json as { data: unknown }).data
          : json;
        if (!raw || typeof raw !== 'object' || typeof (raw as TcgApiCard).id !== 'number') {
          return { error: `card ${id}: card database returned a shape we do not recognise` };
        }
        return { card: normaliseCard(raw as TcgApiCard) };
      } catch (e) {
        return { error: `card ${id}: ${e instanceof Error ? e.message : String(e)}` };
      }
    }));
    for (const r of results) {
      if ('card' in r && r.card) cards.push(r.card);
      else if ('error' in r && r.error) errors.push(r.error);
    }
  }

  /**
   * Fallback: ask the endpoint we have actually verified.
   *
   * `/v1/cards/{id}` is documented but has never returned a verified 200 to
   * us -- this environment cannot reach the host, so it is secondhand
   * information (docs/CATALOG.md is explicit about that). `/v1/search` is
   * verified. So anything the direct lookup could not answer is searched for
   * by the name the user's own collection row remembers, and accepted ONLY on
   * an exact id match.
   *
   * The id match is the whole safety of this. A search for "Kangaskhan ex"
   * returns every print of it, and picking the closest name would be the
   * confidently-wrong failure this project has already paid for once -- except
   * in dollars on a portfolio rather than a card name on a screen.
   *
   * The condition is A PRICE, not a card. The first version of this fell back
   * only when the direct lookup returned NOTHING, and the direct lookup is a
   * card DETAIL endpoint: it can perfectly well answer with the card and put
   * the prices somewhere our normaliser does not read -- per condition, per
   * printing, in a history array. That is exactly what happened on Sterling's
   * portfolio: three cards, no errors reported, and $0.00. A card without a
   * price is a miss.
   */
  const priced = (id: number) =>
    cards.some((c) => Number(c.id) === id && typeof c.marketPrice === 'number');

  for (const id of unique.filter((id) => !priced(id))) {
    const ref = byId.get(id);
    const query = searchTermFor(ref);
    if (!query) {
      errors.push(`card ${id}: no price, and no name to search by`);
      continue;
    }
    try {
      const res = await fetchWithRetry(
        `${BASE}/search?q=${encodeURIComponent(query)}&game=pokemon&limit=100`,
      );
      const json = (await res.json()) as { data?: TcgApiCard[] };
      const found = (Array.isArray(json.data) ? json.data : []).find(
        (c) => c.id === id && typeof c.market_price === 'number',
      );
      if (found) {
        // Replace the priceless version from the direct lookup rather than
        // adding a second entry for the same card.
        const at = cards.findIndex((c) => Number(c.id) === id);
        if (at >= 0) cards[at] = normaliseCard(found);
        else cards.push(normaliseCard(found));
        // Drop the by-id complaint: we have the price, so it is not a failure
        // the user needs to read about.
        const i = errors.findIndex((e) => e.startsWith(`card ${id}:`));
        if (i >= 0) errors.splice(i, 1);
      } else if (!errors.some((e) => e.startsWith(`card ${id}:`))) {
        errors.push(`card ${id}: the card database has no current price for "${query}"`);
      }
    } catch (e) {
      errors.push(`card ${id} (search fallback): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Same funnel rule as searchCards: anything the provider tells our server
  // goes into the catalog, so the next read is free. A cache write that fails
  // must not cost the user the price we already have in hand.
  if (cards.length) lastCacheResult = await cacheCards(cards);

  return { cards, errors };
}

/**
 * A search term from what the collection row remembers.
 *
 * Names are stored inconsistently -- the live database holds both
 * "Iron Leaves ex" and "Kangaskhan ex - 190/165" -- so the trailing
 * " - 075/131" a scan sometimes appends is stripped, and the collector number
 * is added back deliberately when we have it.
 */
export function searchTermFor(ref?: { name?: string | null; number?: string | null }): string | null {
  const name = (ref?.name ?? '').replace(/\s*-\s*\d{1,4}\s*\/\s*\w{1,5}\s*$/, '').trim();
  if (!name) return null;
  const number = (ref?.number ?? '').trim();
  return number ? `${name} ${number}` : name;
}
