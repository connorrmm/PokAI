/**
 * The printed collector number: a second, independent signal read from a
 * different part of the card than the name.
 *
 * Ported from the prototype, with ONE deliberate change, marked below.
 */

export interface CardNumber {
  /** Numerator with leading zeros stripped: '025/185' -> '25'. */
  num: string;
  /** Denominator, i.e. the set total: '025/185' -> '185'. */
  total: string;
}

/** Extract '4/102' or '004/165' from OCR'd text. */
export function extractCardNumber(text: string): CardNumber | null {
  const m = (text || '').match(/(\d{1,4})\s*\/\s*(\d{1,4})/);
  if (!m) return null;
  return { num: String(parseInt(m[1], 10)), total: String(parseInt(m[2], 10)) };
}

/**
 * Does an OCR'd number corroborate this card?
 *
 * Returns null when there is nothing to compare. A MISSING number is not
 * evidence against a card -- treating it as a mismatch would subtract 35 points
 * for a benign failure to read small print, which is exactly the asymmetry
 * docs/SCANNER.md warns about for the image signal.
 *
 * DELIBERATE CHANGE FROM THE PROTOTYPE: the original compared only the
 * numerator, so an OCR read of '25/185' counted as a match for a card printed
 * '25/102'. Those are different prints in different sets, and treating them as
 * corroboration could push a wrong card over the auto-accept bar -- the
 * expensive failure the never-guess rule exists to prevent. Now, when both
 * totals are known and they differ, that is a mismatch.
 *
 * The change is conservative in the right direction: it can only turn a false
 * "match" into a mismatch, never the reverse, so it cannot newly auto-accept
 * anything. Worth re-checking against the accuracy test set when that exists
 * (docs/SCANNER.md), since no tuning here has been validated against real
 * photos yet.
 */
export function numberMatchesCard(
  extracted: CardNumber | null,
  cardNumber: string | null | undefined,
): boolean | null {
  if (!extracted || !cardNumber) return null;

  const raw = String(cardNumber).trim();
  const parts = raw.split('/');
  const cardNum = String(parseInt(parts[0], 10) || parts[0]).trim();
  const cardTotal = parts[1] ? String(parseInt(parts[1], 10)) : null;

  if (cardNum !== extracted.num) return false;
  if (cardTotal && extracted.total && cardTotal !== extracted.total) return false;
  return true;
}

/**
 * Does the SET TOTAL alone corroborate this card? The `131` of `013/131`.
 *
 * This exists because of a real scan. A Flareon photographed at 44px digit
 * height -- ample detail -- was read as `071/131`. The ground-truth note said
 * `017/131`. The catalog says the Prismatic Evolutions Flareon is `013/131`.
 * Three readings, three different numerators, and **all three agreed on 131**.
 *
 * That is not a coincidence. The numerator is one to three small digits and a
 * single misread glyph ruins it. The total is a fixed three-digit group that
 * repeats on every card in a set, and it is the part that survives glare.
 *
 * A set total is weak evidence for one card and strong evidence against most
 * others: it cannot say WHICH Flareon you are holding, but it says that 46 of
 * the 50 in the database are not it. Used only to rank -- never to identify a
 * card outright, and never to remove a candidate from the list, because a
 * misread total must not be able to hide the right card from the user.
 */
export function setTotalMatchesCard(
  extracted: CardNumber | null,
  cardNumber: string | null | undefined,
): boolean | null {
  if (!extracted?.total || !cardNumber) return null;
  const parts = String(cardNumber).trim().split('/');
  if (!parts[1]) return null;
  const cardTotal = String(parseInt(parts[1], 10));
  if (!cardTotal || cardTotal === 'NaN') return null;
  return cardTotal === extracted.total;
}

/** The holofoil patterns the catalog distinguishes, read from a card's name. */
export type HoloPattern = 'none' | 'master_ball' | 'poke_ball' | 'cosmos' | 'other';

/**
 * Which holofoil print a catalog entry is, taken from its name.
 *
 * The catalog encodes this in the name itself -- "Flareon (Master Ball
 * Pattern)", "Flareon - 013/131 (Cosmos Holo)" -- and it is the only thing
 * separating four Prismatic Evolutions Flareons that all carry `013/131` and
 * are worth $0.33, $29.66, $2.16 and $1.31.
 *
 * No collector number can tell those apart, so no amount of work on number
 * reading will ever identify one. The foil pattern is a different signal
 * entirely, and unlike a collector number it is large, high-contrast and
 * spread across the whole card -- exactly the kind of thing that survives a
 * bad photograph.
 */
export function holoPatternOfCard(name: string | null | undefined): HoloPattern {
  const n = (name || '').toLowerCase();
  if (n.includes('master ball')) return 'master_ball';
  if (n.includes('poke ball') || n.includes('poké ball')) return 'poke_ball';
  if (n.includes('cosmos')) return 'cosmos';
  if (n.includes('pattern')) return 'other';
  return 'none';
}
