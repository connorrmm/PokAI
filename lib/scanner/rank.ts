/**
 * Ranking candidates returned by the card database against the OCR'd text.
 * Ported unchanged from the prototype.
 */
import type { ApiCard, RankedCandidate } from './types';
import { normalise, wordSimilarity } from './text';

export function rankCandidatesByName(apiCards: ApiCard[], ocrText: string): RankedCandidate[] {
  const clean = normalise(ocrText);
  return apiCards
    .map((c) => {
      const nameClean = normalise(c.name || '');
      let score: number;
      if (nameClean && (clean.indexOf(nameClean) !== -1 || nameClean.indexOf(clean) !== -1)) {
        score = 95;
      } else {
        score = Math.round(
          wordSimilarity(clean.split(' ')[0] || '', nameClean.split(' ')[0] || '') * 70,
        );
      }
      return { apiCard: c, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Number-based tie-breaking.
 *
 * This matters more than it looks. Many candidates share an identical name
 * score because the same Pokemon appears in dozens of sets. When several tie,
 * the OCR'd collector number is checked against ALL of the tied candidates --
 * not just whichever happened to sort first. If it resolves to exactly one,
 * that one wins outright.
 */
export function resolveTieByNumber(
  ranked: RankedCandidate[],
  extractedNumber: string | null,
): { top: RankedCandidate; numberMatch: boolean | null; resolved: boolean } {
  const top = ranked[0];
  if (!extractedNumber) return { top, numberMatch: null, resolved: false };

  const tied = ranked.filter((r) => r.score === top.score);
  if (tied.length > 1) {
    const matches = tied.filter((r) => numberMatchesCard(extractedNumber, r.apiCard) === true);
    if (matches.length === 1) {
      return { top: matches[0], numberMatch: true, resolved: true };
    }
  }
  return { top, numberMatch: numberMatchesCard(extractedNumber, top.apiCard), resolved: false };
}

/**
 * Compare an OCR'd number against a card's printed number.
 * Returns null when there is nothing to compare -- a missing number is not
 * evidence against a card, and must not be treated as a mismatch.
 */
export function numberMatchesCard(extracted: string | null, card: ApiCard): boolean | null {
  if (!extracted || !card.number) return null;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/^0+/, '');
  const a = norm(extracted);
  const b = norm(String(card.number));
  if (!a || !b) return null;
  if (a === b) return true;
  // '25/185' should match '025/185'; also allow a bare numerator match.
  const numerator = (s: string) => norm(s.split('/')[0] || '');
  if (a.includes('/') && b.includes('/')) return a === b;
  return numerator(a) === numerator(b);
}
