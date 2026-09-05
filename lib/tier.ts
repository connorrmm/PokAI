/**
 * The five rarity tiers the prototype's colours and scoring were built on,
 * derived from the rarity text the card database actually returns.
 *
 * The prototype carried a `tier` on every card because its cards were
 * hardcoded. Real catalog rows carry free text like "Rare Holo",
 * "Illustration Rare" or "Double Rare", so the tier has to be read from that.
 */
export type Tier = 'common' | 'uncommon' | 'rare' | 'holo' | 'secret';

export function tierOf(rarity: string | null | undefined): Tier {
  const r = (rarity || '').toLowerCase();
  // Order matters: "Special Illustration Rare" must land on secret, not rare.
  if (r.includes('secret') || r.includes('special illustration')) return 'secret';
  if (r.includes('illustration') || r.includes('ultra') || r.includes('hyper')) return 'secret';
  if (r.includes('holo') || r.includes('double') || r.includes('gx') || r.includes('vmax')) return 'holo';
  if (r.includes('rare')) return 'rare';
  if (r.includes('uncommon')) return 'uncommon';
  return 'common';
}

export const TIER_LABEL: Record<Tier, string> = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', holo: 'Holo', secret: 'Secret',
};

export const TIER_COLOUR: Record<Tier, string> = {
  common: 'var(--tier-common)',
  uncommon: 'var(--tier-uncommon)',
  rare: 'var(--tier-rare)',
  holo: 'var(--tier-holo)',
  secret: 'var(--tier-secret)',
};
