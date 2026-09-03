/**
 * Turn a vision read plus a list of catalog candidates into a ranked list and
 * a verdict on whether one card is identified.
 *
 * EXTRACTED FROM THE ROUTE AFTER A CONFIDENTLY WRONG ANSWER.
 *
 * A Froakie was read as `088/086`. The app displayed `Froakie - 056/197
 * (Cosmos Holo)` at 99% confidence and told the user "number and set agreed on
 * exactly one card". Those numbers are not the same number.
 *
 * The cause was ordering. The collector-number step correctly found the single
 * card carrying `088/086` and moved it to the front. Then the foil-pattern
 * step re-sorted the list and moved a Cosmos Holo card to the front. Then
 * `uniquelyResolved` was computed from "the number matched exactly one card" --
 * still true -- and the caller accepted whatever was at position 0. A
 * ranking-only signal had displaced an identifying one, and nothing noticed.
 *
 * This lived inside an HTTP handler, so it could not be tested, which is the
 * same root cause docs/STATUS.md records for the original single-file build:
 * the never-guess rule was unassertable because it lived inside a function
 * that also drove the camera.
 *
 * The rule the structure now enforces:
 *
 *   Weak signals rank. Strong signals identify. Ranking runs FIRST, and
 *   identifying runs LAST, so nothing can move a card out from under a verdict
 *   that has already been made about it.
 */
import type { RankedCandidate } from './types';
import {
  numberMatchesCard, extractCardNumber, setTotalMatchesCard, holoPatternOfCard,
  type CardNumber,
} from './number';

export interface ResolveInput {
  ranked: RankedCandidate[];
  number: string | null;
  numberConfidence: number;
  setName: string | null;
  setConfidence: number;
  holoPattern: 'none' | 'master_ball' | 'poke_ball' | 'cosmos' | 'other' | 'unknown';
}

export interface ResolveResult {
  ranked: RankedCandidate[];
  extracted: CardNumber | null;
  /** True/false when the number could be compared, null when it could not. */
  numberMatch: boolean | null;
  /** May this scan name one card outright? */
  uniquelyResolved: boolean;
  counts: {
    numberMatches: number;
    setTotalMatches: number;
    patternMatches: number;
    setMatches: number;
  };
}

/**
 * Only a signal the model is actually SURE of may identify a card. A scan once
 * reported its number as "tentative" and its set as "inferred from the artwork
 * rather than a clearly legible symbol"; treating those as facts would have
 * auto-accepted one of three cards priced $5.81, $8.86 and $26.76.
 */
export const SIGNAL_CERTAINTY_FLOOR = 80;

/** Move `subset` to the front, keeping the rest in order. */
function promote(ranked: RankedCandidate[], subset: RankedCandidate[]): RankedCandidate[] {
  if (subset.length === 0 || subset.length >= ranked.length) return ranked;
  return [...subset, ...ranked.filter((r) => !subset.includes(r))];
}

export function resolveCandidates(input: ResolveInput): ResolveResult {
  let ranked = input.ranked;
  const extracted = input.number ? extractCardNumber(input.number) : null;

  const numberMatches = extracted
    ? ranked.filter((r) => numberMatchesCard(extracted, r.apiCard.number) === true)
    : [];

  // ---- Ranking pass. Weakest first, so stronger signals overwrite weaker
  // ones as we go. Nothing here may identify a card.

  // The set total, when the full number matched nothing. A Flareon read as
  // `071/131` matched no candidate, but four are `013/131` and `/131` was the
  // part every source agreed on.
  let setTotalMatches: RankedCandidate[] = [];
  if (extracted && numberMatches.length === 0) {
    setTotalMatches = ranked.filter((r) => setTotalMatchesCard(extracted, r.apiCard.number) === true);
    ranked = promote(ranked, setTotalMatches);
  }

  // The foil pattern, which separates prints sharing a number. Four Prismatic
  // Evolutions Flareons carry `013/131` at $0.33, $29.66, $2.16 and $1.31.
  let patternMatches: RankedCandidate[] = [];
  if (input.holoPattern && input.holoPattern !== 'unknown') {
    patternMatches = ranked.filter((r) => holoPatternOfCard(r.apiCard.name) === input.holoPattern);
    ranked = promote(ranked, patternMatches);
  }

  // The set name, when legible.
  let setMatches: RankedCandidate[] = [];
  if (input.setName) {
    const want = input.setName.toLowerCase();
    setMatches = ranked.filter((r) => (r.apiCard.setName || '').toLowerCase().includes(want));
    ranked = promote(ranked, setMatches);
  }

  // ---- Identifying pass. Runs LAST so nothing can reorder underneath it.

  let numberMatch: boolean | null = null;
  let uniquelyResolved = false;

  if (extracted) {
    if (numberMatches.length === 1) {
      // The catalog corroborates the number: exactly one card carries it.
      // Stronger than any ranking signal above, so it takes the front and
      // keeps it.
      ranked = promote(ranked, numberMatches);
      numberMatch = true;
      uniquelyResolved = true;
    } else if (numberMatches.length > 1) {
      ranked = promote(ranked, numberMatches);
      // Several prints share the number -- true of every Master Ball and Poke
      // Ball variant. The number corroborates the group but cannot choose
      // within it, so this must not identify a card.
      numberMatch = true;
    } else {
      numberMatch = numberMatchesCard(extracted, ranked[0]?.apiCard.number ?? null);
    }
  }

  // Number and set name agreeing independently. Kept for when a set symbol is
  // legible, which in every scan recorded so far it has not been.
  if (!uniquelyResolved
    && input.numberConfidence >= SIGNAL_CERTAINTY_FLOOR
    && input.setConfidence >= SIGNAL_CERTAINTY_FLOOR
    && numberMatches.length > 0 && setMatches.length > 0) {
    const both = numberMatches.filter((r) => setMatches.includes(r));
    if (both.length === 1) {
      ranked = promote(ranked, both);
      numberMatch = true;
      uniquelyResolved = true;
    }
  }

  // ---- The invariant that would have caught the Froakie.
  //
  // If this scan claims to have identified a card, the card at the front must
  // be one the evidence actually points at. Anything else is the app telling a
  // collector something it does not know, which is the one failure this
  // product cannot afford. Withdraw the claim rather than trust the ordering.
  if (uniquelyResolved && extracted) {
    const head = ranked[0];
    if (!head || numberMatchesCard(extracted, head.apiCard.number) !== true) {
      uniquelyResolved = false;
      numberMatch = false;
    }
  }

  return {
    ranked,
    extracted,
    numberMatch,
    uniquelyResolved,
    counts: {
      numberMatches: numberMatches.length,
      setTotalMatches: setTotalMatches.length,
      patternMatches: patternMatches.length,
      setMatches: setMatches.length,
    },
  };
}
