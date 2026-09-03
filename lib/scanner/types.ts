/** A card as returned by our API, normalised from whatever provider answered. */
export interface ApiCard {
  id: number | string;
  name: string;
  number?: string | null;
  rarity?: string | null;
  setName?: string | null;
  printing?: string | null;
  imageUrl?: string | null;
  marketPrice?: number | null;
  /** When the PROVIDER says this price was true -- not when we fetched it. */
  priceUpdatedAt?: string | null;

  /**
   * Compatibility shape for the original single-file app, which is still the
   * LIVE product at '/' and consumes this same endpoint. It reads
   * `set.name` and `images.small` rather than the flat fields above.
   *
   * Changing the response shape without these silently degraded the live app:
   * every card showed "Unknown Set", card art disappeared, and the
   * image-similarity signal was skipped entirely because `images` was
   * undefined. Nothing errored -- it just quietly got worse, which is the
   * failure mode this project keeps being bitten by.
   *
   * Remove only once '/' no longer serves public/app.html.
   */
  set?: { name: string | null } | null;
  images?: { small: string | null; large: string | null } | null;
}

export interface RankedCandidate {
  apiCard: ApiCard;
  score: number;
}

/**
 * What the scanner actually saw, surfaced to the user.
 *
 * Every failure so far has been diagnosed by guesswork because a failed scan
 * said only that it failed. Knowing whether OCR read nothing, read the wrong
 * words, or read correctly and then lost on ranking points at three completely
 * different fixes -- and the difference is invisible from the outside.
 */
export interface ScanDiagnostics {
  /** Exact text OCR returned, before any cleanup. */
  ocrText: string;
  /** Which crop attempt produced it (e.g. 'crop-24', 'full-frame'). */
  ocrStrategy: string | null;
  /** Collector number read from the bottom strip, if any. */
  numberText: string | null;
  /** How many cards the database returned for that text. */
  candidatesFound: number;
  /** Name-match score of the best candidate, 0-100. */
  topScore: number | null;
  /** Name of the best candidate, whether or not it was accepted. */
  topName: string | null;
  /** The bar this scan had to clear, which rises for valuable cards. */
  autoAcceptFloor: number | null;
  /** Milliseconds spent, end to end. */
  elapsedMs: number;
  /** What this scan cost, from real token counts rather than an estimate. */
  usage?: { inputTokens: number; outputTokens: number; model: string; costUsd: number } | null;
  /**
   * How many candidates share the set total we read (the `131` of `013/131`),
   * when the full number matched none. These are ranked first.
   */
  setTotalMatchCount?: number | null;
  /** Did the number and set together identify exactly one print? */
  uniquelyResolved?: boolean;
  /**
   * How much detail the photo actually contained where the collector number
   * is printed. `digitPx` is the estimated pixel height of those digits in the
   * crop we sent.
   *
   * Diagnostic, not decorative. Run 02 showed the model calling the crop
   * "blurry" on four cards out of five; this says whether that is blur or
   * simply an absence of pixels, which have completely different fixes.
   */
  numberDetail?: { sourceWidth: number; sourceHeight: number; digitPx: number } | null;
}

export type IdentifyOutcome =
  | { ok: true; source: 'live-db'; text: string; apiCard: ApiCard; matchScore: number;
      confidence: number; numberMatch: boolean | null; imageSimilarity: number | null }
  | { ok: false; reason: 'low_confidence' | 'ambiguous'; text: string; confidence: number;
      topGuess: ApiCard | null; candidates: ApiCard[] }
  | { ok: false; reason: 'no_text' | 'no_match' | 'ocr_unavailable' | 'ocr_error';
      text: string; errorDetail?: string; candidates?: ApiCard[] };

/** Any outcome, plus what the scanner saw getting there. */
export type IdentifyResult = IdentifyOutcome & { diagnostics?: ScanDiagnostics };
