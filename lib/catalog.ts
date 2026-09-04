import 'server-only';
/**
 * Fill our own card catalog as cards are looked up.
 *
 * WHY THIS EXISTS. `cards` was empty, and `collections.card_id`,
 * `scans.chosen_card_id` and both `corrections` card columns carry foreign
 * keys to it. So every "Add to my collection" failed on a foreign key
 * violation, and the collections table had zero rows -- the feature had never
 * worked once. `card_prices` being empty meant every saved card would also
 * have shown "Value unavailable" forever, so the portfolio total would have
 * been zero no matter what anyone owned.
 *
 * CLAUDE.md settled this on 2026-08-31: "Card data is cached in our own
 * database and refreshed on a schedule. The scan path never depends on a third
 * party being up." The cache was designed and then never filled.
 *
 * Filling it HERE, inside the one function every card lookup goes through,
 * rather than at the point of saving, for two reasons. It cannot be forgotten
 * by a future code path. And it never trusts the browser: the rows written are
 * the ones the provider returned to our server, not whatever a client posted.
 *
 * LICENCE. tcgapi.dev permits exactly this -- "storage is fine, redistribution
 * is not". Migration 0004 already revoked catalog access from anon and
 * authenticated so these rows can never be served onward.
 */
import type { ApiCard } from './scanner/types';
import { admin } from './supabase/server';

/** '190/165' -> true. The chase cards, and the ones that break naive validation. */
function isSecret(number: string | null): boolean {
  if (!number) return false;
  const m = number.match(/(\d{1,4})\s*\/\s*(\d{1,4})/);
  if (!m) return false;
  return parseInt(m[1], 10) > parseInt(m[2], 10);
}

/**
 * Never throws and never blocks correctness. A scan that found the right card
 * must not fail because our cache could not be written -- the user got their
 * answer, and our bookkeeping is our problem.
 */
export async function cacheCards(cards: ApiCard[]): Promise<void> {
  if (!cards.length) return;
  const sb = admin();
  if (!sb) return;

  try {
    const rows = cards
      .filter((c) => Number.isFinite(Number(c.id)) && c.name)
      .map((c) => ({
        id: Number(c.id),
        name: c.name,
        number: c.number ?? null,
        rarity: c.rarity ?? null,
        printing: c.printing ?? null,
        set_name: c.setName ?? null,
        image_url: c.imageUrl ?? null,
        game_slug: 'pokemon',
        is_secret: isSecret(c.number ?? null),
        source: 'tcgapi.dev',
        synced_at: new Date().toISOString(),
      }));
    if (!rows.length) return;

    const { error } = await sb.from('cards').upsert(rows, { onConflict: 'id' });
    if (error) { console.warn('Could not cache cards:', error.message); return; }

    // Prices are appended, not upserted: card_prices is a time series and
    // card_prices_latest reads the most recent row per card and printing.
    // Only rows with an actual price -- a null would land in the series as a
    // real observation of "worth nothing".
    const priced = cards
      .filter((c) => typeof c.marketPrice === 'number' && Number.isFinite(Number(c.id)))
      .map((c) => ({
        card_id: Number(c.id),
        printing: c.printing || 'Normal',
        market_price: c.marketPrice as number,
        source: 'tcgapi.dev',
        // The provider's own timestamp: when the price was TRUE, not when we
        // fetched it. docs/PRODUCT.md rule 10, market transparency.
        source_updated_at: c.priceUpdatedAt ?? null,
      }));

    if (priced.length) {
      // Only write an observation that differs from the one already held.
      //
      // A single Flareon scan searches and returns fifty cards, so appending
      // unconditionally wrote fifty price rows per scan, nearly all identical
      // to the last. That is not a time series, it is the same measurement
      // recorded over and over -- and it makes `card_prices_latest`'s
      // DISTINCT ON sort through ever more duplicates to find the same answer.
      const { data: known } = await sb
        .from('card_prices_latest')
        .select('card_id, printing, market_price, source_updated_at')
        .in('card_id', priced.map((p) => p.card_id));

      const seen = new Map<string, { price: number | null; at: string | null }>();
      for (const k of known ?? []) {
        seen.set(`${k.card_id}|${k.printing}`, {
          price: k.market_price === null ? null : Number(k.market_price),
          at: k.source_updated_at ?? null,
        });
      }

      const fresh = priced.filter((p) => {
        const prev = seen.get(`${p.card_id}|${p.printing}`);
        if (!prev) return true;
        return prev.price !== p.market_price || prev.at !== p.source_updated_at;
      });

      if (fresh.length) {
        const { error: pErr } = await sb.from('card_prices').insert(fresh);
        if (pErr) console.warn('Could not cache prices:', pErr.message);
      }
    }
  } catch (e) {
    console.warn('Could not cache cards:', e);
  }
}
