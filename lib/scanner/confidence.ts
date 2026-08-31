/**
 * Confidence scoring and the auto-accept decision.
 *
 * Extracted from the prototype so it can finally be TESTED. In the single-file
 * build this logic was tangled up with camera access, OCR and DOM updates, so
 * the never-guess rule could only be checked by hand -- which is exactly how a
 * build shipped that silently stopped showing candidates.
 *
 * The numbers below are ported unchanged. docs/SCANNER.md explains why each
 * exists; the short version is at each line.
 */
import type { ApiCard, RankedCandidate } from './types';

/** Below this, we do not even offer a guess as plausible. */
export const RESCAN_FLOOR = 60;
/** Candidates scoring at least this are worth showing the user. */
export const CANDIDATE_FLOOR = 60;

/**
 * A card worth this much or more must clear a higher bar before we accept it
 * automatically. Being wrong about a $3 common costs nothing to fix; being
 * wrong about a $2,000 card is a real problem.
 */
export const HIGH_VALUE_THRESHOLD = 100;
export const AUTO_ACCEPT_FLOOR = 92;
export const AUTO_ACCEPT_FLOOR_HIGH_VALUE = 97;

export function autoAcceptFloorFor(cardValue: number | null | undefined): number {
  return (cardValue ?? 0) >= HIGH_VALUE_THRESHOLD
    ? AUTO_ACCEPT_FLOOR_HIGH_VALUE
    : AUTO_ACCEPT_FLOOR;
}

export interface ConfidenceSignals {
  /** Dominant signal. An exact name match should nearly carry the decision. */
  nameScore: number;
  /** Printed collector number: strong corroboration, and a mismatch is strong evidence against. */
  numberMatch?: boolean | null;
  /** Capture quality. Small effect only. */
  qualityScore?: number | null;
  /**
   * Perceptual-hash similarity to the reference image. BONUS ONLY -- never
   * allowed to subtract, because it fails for benign reasons (CORS, canvas
   * taint, lighting) and a missing signal must not look like evidence against.
   */
  imageSimilarity?: number | null;
}

export function computeConfidence({
  nameScore, numberMatch, qualityScore, imageSimilarity,
}: ConfidenceSignals): number {
  let confidence = nameScore;
  if (numberMatch === true) confidence = Math.min(100, confidence + 8);
  else if (numberMatch === false) confidence -= 35;
  if (typeof imageSimilarity === 'number' && imageSimilarity >= 75) {
    confidence = Math.min(100, confidence + 6);
  }
  const q = qualityScore == null ? 85 : qualityScore;
  confidence += Math.max(-5, Math.min(5, (q - 85) * 0.3));
  return Math.max(0, Math.min(100, Math.round(confidence)));
}

/**
 * Is the top candidate clearly ahead of the field?
 *
 * Not just "highest score" -- many Pokemon appear in dozens of sets, so ties on
 * name are the normal case rather than an edge case. A tie is never "clearly
 * best" no matter how high the score.
 */
export function isClearlyBest(ranked: RankedCandidate[]): boolean {
  if (ranked.length === 0) return false;
  const top = ranked[0];
  const ties = ranked.filter((r) => r.score === top.score).length;
  const second = ranked[1];
  return ties === 1 && (!second || top.score - second.score >= 15);
}
