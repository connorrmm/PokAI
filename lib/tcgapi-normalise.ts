/**
 * Pure normalisation of tcgapi.dev responses into our card shape.
 *
 * Deliberately separate from lib/tcgapi.ts, which is `server-only` because it
 * reads the API key. Keeping the pure part out of that module is what makes
 * the response contract testable at all.
 */
import type { ApiCard } from './scanner/types';

/** Raw shape returned by tcgapi.dev, from an observed live response. */
export interface TcgApiCard {
  id: number;
  name: string;
  clean_name?: string;
  number?: string;
  rarity?: string;
  tcgplayer_id?: number;
  product_type?: string;
  foil_only?: number;
  total_listings?: number;
  game_name?: string;
  game_slug?: string;
  set_name?: string;
  printing?: string;
  market_price?: number;
  low_price?: number;
  median_price?: number;
  lowest_with_shipping?: number;
  price_updated_at?: string;
  image_url?: string;
}

export function normaliseCard(c: TcgApiCard): ApiCard {
  return {
    id: c.id,
    name: c.name,
    number: c.number ?? null,
    rarity: c.rarity ?? null,
    setName: c.set_name ?? null,
    printing: c.printing ?? null,
    imageUrl: c.image_url ?? null,
    marketPrice: typeof c.market_price === 'number' ? c.market_price : null,
    // Provider's own timestamp: when the price was true, NOT when we fetched.
    priceUpdatedAt: c.price_updated_at ?? null,

    // Compatibility for the original app still served at '/'. It reads
    // set.name and images.small; without these it shows "Unknown Set", loses
    // card art, and silently skips the image-similarity check.
    set: { name: c.set_name ?? null },
    images: { small: c.image_url ?? null, large: c.image_url ?? null },
  };
}
