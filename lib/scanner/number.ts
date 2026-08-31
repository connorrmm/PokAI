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
