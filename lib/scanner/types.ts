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
