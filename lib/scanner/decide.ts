/**
 * THE NEVER-GUESS RULE, as a pure function.
 *
 * This is the most important code in PokAI, and until now it has never been
 * testable. In the single-file prototype the decision was buried inside an
 * async function that also drove the camera, ran OCR and touched the DOM, so
 * the only way to check it was to scan a card and look. A build duly shipped
 * that stopped returning candidates on a low-confidence read -- the exact dead
 * end docs/PRODUCT.md forbids -- and nobody noticed for weeks.
 *
 * Isolating it here means the rule is now covered by tests that fail loudly.
 *
 * The rule, from docs/PRODUCT.md:
 *   - Confident and unambiguous  -> accept automatically. This should feel magical.
 *   - Anything less              -> show EVERY card matching the name we read.
 *   - Never a truncated list. Never a bare "couldn't read that card".
 */
import type { ApiCard, IdentifyOutcome, RankedCandidate } from './types';
import { CANDIDATE_FLOOR, RESCAN_FLOOR, autoAcceptFloorFor, isClearlyBest } from './confidence';

export interface DecideInput {
  text: string;
  ranked: RankedCandidate[];
  confidence: number;
  /** Market value of the top candidate, used to pick the auto-accept bar. */
  topValue?: number | null;
  numberMatch?: boolean | null;
  imageSimilarity?: number | null;
  /**
   * Two independent signals read off the card -- the collector number AND the
   * set -- agreed on exactly ONE candidate.
   *
   * This exists because name score alone cannot express it. Every print of a
   * card shares its name, so they all tie on name and "clearly best" is never
   * true, even when the printed number and set identify one print beyond
   * doubt. A real scan of an Eevee ex read '075/131' and 'Prismatic
   * Evolutions' correctly and was still shown five options, because three
   * different cards share that number and the tie was never broken.
   *
   * Deliberately demanding: it requires BOTH signals present, agreeing, and
   * narrowing to a single candidate. One signal alone is corroboration, not
   * proof, and still goes to the user.
   */
  uniquelyResolved?: boolean;
}

export function decide({
  text, ranked, confidence, topValue, numberMatch = null, imageSimilarity = null,
  uniquelyResolved = false,
}: DecideInput): IdentifyOutcome {
  if (ranked.length === 0) {
    return { ok: false, reason: 'no_match', text };
  }

  const top = ranked[0];
  // Independent corroboration on a single card counts as being clearly best.
  // The confidence threshold below still has to be cleared on its own.
  const clearlyBest = uniquelyResolved || isClearlyBest(ranked);
  const floor = autoAcceptFloorFor(topValue);

  if (confidence >= floor && clearlyBest) {
    return {
      ok: true, source: 'live-db', text, apiCard: top.apiCard,
      matchScore: top.score, confidence, numberMatch, imageSimilarity,
    };
  }

  // Whenever the exact print cannot be pinned down -- a weak read, or several
  // prints tied on name -- the honest answer is neither a guess nor a dead end.
  // It is every card matching the name we did read, so the person can just tap
  // theirs.
  //
  // NOT truncated. An earlier build capped this at 8 and dropped it entirely on
  // the low-confidence path; both are regressions, not optimisations. If a name
  // genuinely matches 40 prints, the user needs to see 40.
  const candidates: ApiCard[] = ranked
    .filter((r) => r.score >= CANDIDATE_FLOOR)
    .map((r) => r.apiCard);

  return {
    ok: false,
    reason: confidence < RESCAN_FLOOR ? 'low_confidence' : 'ambiguous',
    text,
    confidence,
    topGuess: top.apiCard,
    candidates,
  };
}
