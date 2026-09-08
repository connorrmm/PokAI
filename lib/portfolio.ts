import 'server-only';
/**
 * Valuing a collection, shared by /api/collection and /api/portfolio.
 *
 * Extracted rather than duplicated because two endpoints computing a total
 * slightly differently is how a portfolio figure quietly stops matching the
 * list it is supposedly the sum of.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiCard } from './scanner/types';

/**
 * Looks cards up with the provider when our own catalog cannot price them.
 *
 * Injected rather than imported so this module stays testable against a fake:
 * the interesting cases are "cache has it", "cache does not and the provider
 * does", and "neither", and only the first is reachable without one.
 */
export interface CardRef {
  id: number;
  /** What the user's own collection row remembers, for the search fallback. */
  name?: string | null;
  number?: string | null;
}

export type LiveLookup = (refs: CardRef[]) => Promise<{ cards: ApiCard[]; errors: string[] }>;

/**
 * The most cards we will ask the provider about in one page load.
 *
 * A backfill is meant to cover the gap left by a cache that was never written,
 * not to become the way prices are fetched. Anything past this is left
 * unpriced and SAID to be unpriced, which is honest and bounded; the nightly
 * sync is what is supposed to close a gap this size.
 */
const LIVE_LOOKUP_CAP = 25;

export interface CollectionItem {
  id: number;
  cardId: number | null;
  quantity: number;
  condition: string | null;
  notes: string | null;
  addedAt: string;
  name: string | null;
  setName: string | null;
  number: string | null;
  rarity: string | null;
  imageUrl: string | null;
  marketPrice: number | null;
}

export interface Totals {
  cards: number;
  valued: number;
  /**
   * Cards with no price available. Reported so a partial total is never
   * mistaken for a complete one -- a portfolio figure that quietly omits cards
   * is worse than no figure (product rule 2).
   */
  unpriced: number;
  marketValue: number;
}

export async function loadCollection(
  db: SupabaseClient,
  sb: SupabaseClient | null,
  lookup?: LiveLookup,
): Promise<
  | { items: CollectionItem[]; totals: Totals; priceProblem: string | null }
  | { error: string; code?: string; status: number }
> {
  const { data, error } = await db
    .from('collections')
    .select('id, card_id, quantity, condition, notes, created_at, card_name, card_set_name, card_number')
    .order('created_at', { ascending: false });

  if (error) {
    const status = /jwt|token|expired/i.test(error.message) ? 401 : 500;
    return { error: error.message, code: error.code, status };
  }

  const rows = data ?? [];
  const ids = rows.map((r) => r.card_id).filter((v): v is number => typeof v === 'number');
  const live = new Map<number, { imageUrl: string | null; rarity: string | null; marketPrice: number | null }>();
  const problems: string[] = [];

  if (ids.length && !sb) {
    problems.push('the card catalog is unreadable (SUPABASE_SERVICE_ROLE_KEY missing or unreadable)');
  }

  if (ids.length && sb) {
    const [cardRes, priceRes] = await Promise.all([
      sb.from('cards').select('id, image_url, rarity').in('id', ids),
      sb.from('card_prices_latest').select('card_id, market_price').in('card_id', ids),
    ]);
    // Discarding these turned a broken service-role read into "Value
    // unavailable" on every card and a $0.00 portfolio, served with a 200 and
    // nothing logged anywhere. Rule 4: a failure must say what it was.
    if (cardRes.error) {
      console.warn('Catalog read failed:', cardRes.error.message);
      problems.push(`catalog read failed: ${cardRes.error.message}`);
    }
    if (priceRes.error) {
      console.warn('Price read failed:', priceRes.error.message);
      problems.push(`price read failed: ${priceRes.error.message}`);
    }
    const cardRows = cardRes.data;
    const priceRows = priceRes.data;
    const priceOf = new Map<number, number | null>();
    for (const p of priceRows ?? []) {
      if (!priceOf.has(p.card_id)) priceOf.set(p.card_id, p.market_price);
    }
    for (const c of cardRows ?? []) {
      live.set(c.id, {
        imageUrl: c.image_url ?? null,
        rarity: c.rarity ?? null,
        marketPrice: priceOf.get(c.id) ?? null,
      });
    }
  }

  /**
   * Anything our own catalog could not put a price on, asked of the provider.
   *
   * This is the difference between a portfolio that works and one that waits:
   * a card only lands in the cache when someone searches for it, so a card
   * saved before the cache could be written stays unpriced forever otherwise.
   * The price used here is the provider's current one, not a remembered figure
   * -- rule 2 forbids presenting a stale number as today's.
   */
  if (lookup) {
    const unpriced = rows
      .filter((r) => typeof r.card_id === 'number'
        && typeof live.get(r.card_id)?.marketPrice !== 'number')
      .map((r) => ({ id: r.card_id as number, name: r.card_name, number: r.card_number }))
      .filter((ref, i, all) => all.findIndex((o) => o.id === ref.id) === i);
    if (unpriced.length) {
      const asked = unpriced.slice(0, LIVE_LOOKUP_CAP);
      try {
        const { cards, errors } = await lookup(asked);
        for (const c of cards) {
          const id = Number(c.id);
          if (!Number.isFinite(id)) continue;
          const had = live.get(id);
          live.set(id, {
            // The cached row wins on art and rarity when it has them; the
            // provider is only being consulted about the price.
            imageUrl: had?.imageUrl ?? c.imageUrl ?? null,
            rarity: had?.rarity ?? c.rarity ?? null,
            marketPrice: typeof c.marketPrice === 'number' ? c.marketPrice : (had?.marketPrice ?? null),
          });
        }
        problems.push(...errors);
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      }
      if (unpriced.length > asked.length) {
        problems.push(
          `${unpriced.length - asked.length} more card(s) were left unpriced this load `
          + `(at most ${LIVE_LOOKUP_CAP} are looked up live)`,
        );
      }
    }
  }

  const items: CollectionItem[] = rows.map((r) => {
    const l = r.card_id != null ? live.get(r.card_id) : undefined;
    return {
      id: r.id,
      cardId: r.card_id,
      quantity: r.quantity,
      condition: r.condition,
      notes: r.notes,
      addedAt: r.created_at,
      // The user's own snapshot, taken when they added it. Survives the cached
      // catalog being purged (migration 0005).
      name: r.card_name,
      setName: r.card_set_name,
      number: r.card_number,
      rarity: l?.rarity ?? null,
      imageUrl: l?.imageUrl ?? null,
      marketPrice: l?.marketPrice ?? null,
    };
  });

  const totals = totalsOf(items);

  // Only a problem if it actually cost someone a price. The catalog being
  // unreadable while the provider answered is a cache miss, not a failure the
  // user needs to read about -- reporting it anyway is the false alarm that
  // trains people to ignore the banner.
  const priceProblem = totals.unpriced > 0 && problems.length
    ? [...new Set(problems)].join('; ')
    : null;

  return { items, totals, priceProblem };
}

export function totalsOf(items: CollectionItem[]): Totals {
  let cards = 0; let valued = 0; let marketValue = 0;
  for (const i of items) {
    cards += i.quantity;
    if (typeof i.marketPrice === 'number') {
      valued += i.quantity;
      marketValue += i.marketPrice * i.quantity;
    }
  }
  return { cards, valued, unpriced: cards - valued, marketValue: Math.round(marketValue * 100) / 100 };
}
