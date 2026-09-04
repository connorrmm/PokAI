import 'server-only';
/**
 * Valuing a collection, shared by /api/collection and /api/portfolio.
 *
 * Extracted rather than duplicated because two endpoints computing a total
 * slightly differently is how a portfolio figure quietly stops matching the
 * list it is supposedly the sum of.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

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
): Promise<{ items: CollectionItem[]; totals: Totals } | { error: string; code?: string; status: number }> {
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

  if (ids.length && sb) {
    const [cardRes, priceRes] = await Promise.all([
      sb.from('cards').select('id, image_url, rarity').in('id', ids),
      sb.from('card_prices_latest').select('card_id, market_price').in('card_id', ids),
    ]);
    // Discarding these turned a broken service-role read into "Value
    // unavailable" on every card and a $0.00 portfolio, served with a 200 and
    // nothing logged anywhere. Rule 4: a failure must say what it was.
    if (cardRes.error) console.warn('Catalog read failed:', cardRes.error.message);
    if (priceRes.error) console.warn('Price read failed:', priceRes.error.message);
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

  return { items, totals: totalsOf(items) };
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
