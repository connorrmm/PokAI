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

export type IdentifyOutcome =
  | { ok: true; source: 'live-db'; text: string; apiCard: ApiCard; matchScore: number;
      confidence: number; numberMatch: boolean | null; imageSimilarity: number | null }
  | { ok: false; reason: 'low_confidence' | 'ambiguous'; text: string; confidence: number;
      topGuess: ApiCard | null; candidates: ApiCard[] }
  | { ok: false; reason: 'no_text' | 'no_match' | 'ocr_unavailable' | 'ocr_error';
      text: string; errorDetail?: string; candidates?: ApiCard[] };
