/**
 * The five standard grades a collector actually uses.
 *
 * From docs/PRODUCT.md, Tier 1 MVP item 9, including two rules that are easy
 * to get wrong and expensive to get wrong:
 *
 * DEFAULTS TO UNSET, NOT NEAR MINT. Defaulting to the best grade quietly
 * inflates every collection that never touches the field, and the person who
 * would notice is the one who trusted the total.
 *
 * NEVER ASSESSED FROM THE PHOTO. docs/OPEN-QUESTIONS.md #8. Grading is a
 * judgement about edges, surface and centring that a scan cannot make, and a
 * machine-assigned grade would be a valuation nobody agreed to.
 */
export const CONDITIONS = [
  'Near Mint',
  'Lightly Played',
  'Moderately Played',
  'Heavily Played',
  'Damaged',
] as const;

export type Condition = (typeof CONDITIONS)[number];

/** Short forms for a phone screen, where five full names do not fit. */
export const CONDITION_SHORT: Record<Condition, string> = {
  'Near Mint': 'NM',
  'Lightly Played': 'LP',
  'Moderately Played': 'MP',
  'Heavily Played': 'HP',
  'Damaged': 'DMG',
};

/**
 * Null for anything not exactly one of the five.
 *
 * The server must not store whatever text a client sends: condition is part of
 * the key that separates one holding from another, so free text would let the
 * same card fragment into unlimited rows.
 */
export function parseCondition(value: unknown): Condition | null {
  if (typeof value !== 'string') return null;
  const match = CONDITIONS.find((c) => c === value.trim());
  return match ?? null;
}
