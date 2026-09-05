/**
 * Collection Score, ported from the prototype's formula unchanged.
 *
 *   value   min(400, log10(total) x 90)      -- diminishing returns on money
 *   rarity  min(300, sum(tier points) x 4)   -- common 1, uncommon 3, rare 8,
 *                                               holo 20, secret 50
 *   sets    min(150, unique sets x 30)       -- breadth, not just depth
 *   vintage min(150, 35 per pre-2006 card, 12 per pre-2023)
 *
 * ONE HONEST DIFFERENCE. The prototype read a `year` off each hardcoded card.
 * Real catalog rows have no release year -- `card_sets` is not populated, and
 * the search response carries no date -- so vintage cannot be computed, and
 * returning 0 for it would be a silent wrong answer dressed as a real one.
 * It is returned as `null` and the UI says it is not counted yet, which keeps
 * the score honest and the scale unchanged for when set dates are cached.
 */
import { tierOf, type Tier } from './tier';

const TIER_POINTS: Record<Tier, number> = {
  common: 1, uncommon: 3, rare: 8, holo: 20, secret: 50,
};

export interface ScoreInput {
  totalValue: number;
  cards: Array<{ rarity: string | null; setName: string | null; quantity: number }>;
}

export interface Score {
  total: number;
  value: number;
  rarity: number;
  sets: number;
  /** Null while set release dates are not cached. Never silently zero. */
  vintage: number | null;
  /** The most this score could reach with what can currently be measured. */
  measurableMax: number;
}

export function computeCollectionScore(input: ScoreInput): Score {
  const value = Math.min(400, Math.round(Math.log10(Math.max(1, input.totalValue)) * 90));

  const rarityPoints = input.cards.reduce(
    (sum, c) => sum + TIER_POINTS[tierOf(c.rarity)] * Math.max(1, c.quantity), 0,
  );
  const rarity = Math.min(300, rarityPoints * 4);

  const uniqueSets = new Set(
    input.cards.map((c) => (c.setName || '').trim().toLowerCase()).filter(Boolean),
  ).size;
  const sets = Math.min(150, uniqueSets * 30);

  return {
    total: value + rarity + sets,
    value, rarity, sets,
    vintage: null,
    measurableMax: 850,   // 1000 once vintage can be measured
  };
}

export interface Achievement { id: string; icon: string; name: string; earned: boolean }

/**
 * The prototype's list, minus the three that depended on tournaments and
 * leaderboards. Those are hardcoded fake data in the prototype and there is
 * nothing real to check them against; an achievement that cannot be earned is
 * worse than one that does not exist.
 */
export function achievements(input: {
  cardCount: number;
  totalValue: number;
  cards: Array<{ rarity: string | null; setName: string | null }>;
}): Achievement[] {
  const uniqueSets = new Set(
    input.cards.map((c) => (c.setName || '').trim().toLowerCase()).filter(Boolean),
  ).size;
  const hasSecret = input.cards.some((c) => tierOf(c.rarity) === 'secret');

  return [
    { id: 'first_scan', icon: '🃏', name: 'First Card Scanned', earned: input.cardCount >= 1 },
    { id: 'ten_cards', icon: '📦', name: '10 Cards Collected', earned: input.cardCount >= 10 },
    { id: 'hundred_cards', icon: '🗄️', name: '100 Cards Collected', earned: input.cardCount >= 100 },
    { id: 'first_secret', icon: '✨', name: 'First Secret Rare', earned: hasSecret },
    { id: 'set_collector', icon: '🧩', name: 'Set Collector', earned: uniqueSets >= 3 },
    { id: 'value_1k', icon: '💰', name: 'Collection Crosses $1k', earned: input.totalValue >= 1000 },
    { id: 'value_20k', icon: '💎', name: 'Collection Crosses $20k', earned: input.totalValue >= 20000 },
  ];
}
