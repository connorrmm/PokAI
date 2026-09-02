'use client';
/**
 * The full identification flow, ported from identifyCardFromPhoto().
 *
 * Order matters and is not arbitrary -- each step is skipped when a cheaper one
 * has already settled the answer, because every extra OCR pass costs seconds on
 * a phone:
 *
 *   1. Read the name. Search the card database.
 *   2. If the name alone is already confident AND unambiguous, stop. That is
 *      most scans once a clean photo is taken.
 *   3. Otherwise read the printed number -- a second, independent signal from a
 *      different part of the card. Use it to break ties across ALL tied
 *      candidates, not just the one that happened to sort first.
 *   4. Still unsettled? Compare the photo to the reference image by perceptual
 *      hash. Bonus only, never a penalty.
 *   5. Decide. Accept, or show every matching print.
 */
import type { ApiCard, IdentifyResult, ScanDiagnostics } from './types';
import { computeConfidence, autoAcceptFloorFor, isClearlyBest } from './confidence';
import { rankCandidatesByName, resolveTieByNumber } from './rank';
import { extractCardNumber } from './number';
import { decide } from './decide';
import {
  readCardName, readCardNumber, computeImageHash, withTimeout, ocrFailureReason,
} from './ocr-client';
import { hammingDistance, hashSimilarity } from './image';

export interface IdentifyInput {
  cardPhoto: string;
  fullFrame?: string | null;
  qualityScore?: number | null;
  /** Injectable so tests and other callers are not tied to fetch. */
  search?: (q: string) => Promise<ApiCard[]>;
}

async function defaultSearch(q: string): Promise<ApiCard[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // Rule 4: carry the REAL message up. A generic failure here is what made
    // this app undebuggable in the field.
    throw new Error(body?.error?.message || `Card search failed (${res.status})`);
  }
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
}

export async function identifyCard({
  cardPhoto, fullFrame, qualityScore, search = defaultSearch,
}: IdentifyInput): Promise<IdentifyResult> {
  const startedAt = Date.now();
  const diag: ScanDiagnostics = {
    ocrText: '', ocrStrategy: null, numberText: null,
    candidatesFound: 0, topScore: null, topName: null,
    autoAcceptFloor: null, elapsedMs: 0,
  };
  const done = <T extends object>(o: T): T & { diagnostics: ScanDiagnostics } => {
    diag.elapsedMs = Date.now() - startedAt;
    return { ...o, diagnostics: diag };
  };

  const read = await readCardName(cardPhoto, fullFrame);
  if (!read) {
    // Say WHY, not just that it failed.
    return done({
      ok: false as const, reason: 'ocr_unavailable' as const, text: '',
      errorDetail: ocrFailureReason() ?? undefined,
    });
  }
  diag.ocrText = read.text;
  diag.ocrStrategy = read.strategy;
  if (!read.text) return done({ ok: false as const, reason: 'no_text' as const, text: '' });

  let candidates: ApiCard[];
  try {
    candidates = await withTimeout(search(read.text), 12_000, 'Searching the card database');
  } catch (e) {
    return done({
      ok: false as const, reason: 'ocr_error' as const, text: read.text,
      errorDetail: e instanceof Error ? e.message : String(e),
    });
  }
  diag.candidatesFound = candidates.length;
  if (candidates.length === 0) {
    return done({ ok: false as const, reason: 'no_match' as const, text: read.text });
  }

  const ranked = rankCandidatesByName(candidates, read.text);
  diag.topScore = ranked[0]?.score ?? null;
  diag.topName = ranked[0]?.apiCard.name ?? null;
  let top = ranked[0];
  let numberMatch: boolean | null = null;
  let imageSimilarity: number | null = null;

  // Step 2: is the name alone enough? Skip the extra OCR pass if so.
  const preliminary = computeConfidence({ nameScore: top.score, numberMatch: null, qualityScore });
  const floor = autoAcceptFloorFor(top.apiCard.marketPrice);
  diag.autoAcceptFloor = floor;
  let settled = preliminary >= floor && isClearlyBest(ranked);

  if (!settled) {
    // Step 3: the printed number.
    const raw = await readCardNumber(cardPhoto);
    diag.numberText = raw;
    const extracted = raw ? extractCardNumber(raw) : null;
    const resolved = resolveTieByNumber(ranked, extracted);
    top = resolved.top;
    numberMatch = resolved.numberMatch;

    // Re-rank so the number-resolved winner leads the candidate list too.
    if (resolved.resolved) {
      const idx = ranked.indexOf(top);
      if (idx > 0) { ranked.splice(idx, 1); ranked.unshift(top); }
    }

    const confidence = computeConfidence({ nameScore: top.score, numberMatch, qualityScore });
    diag.autoAcceptFloor = autoAcceptFloorFor(top.apiCard.marketPrice);
    diag.topScore = top.score;
    diag.topName = top.apiCard.name;
    settled = confidence >= diag.autoAcceptFloor && isClearlyBest(ranked);

    // Step 4: perceptual hash, only if still unsettled and we have a reference.
    if (!settled && top.apiCard.imageUrl) {
      try {
        const [a, b] = await withTimeout(
          Promise.all([computeImageHash(cardPhoto), computeImageHash(top.apiCard.imageUrl)]),
          10_000, 'Comparing card photo',
        );
        imageSimilarity = hashSimilarity(hammingDistance(a, b));
      } catch (e) {
        // Benign: CORS, canvas taint, a slow image. Signal unavailable, not
        // evidence against the card.
        console.warn('Image similarity check failed:', e);
      }
    }
  }

  const confidence = computeConfidence({
    nameScore: top.score, numberMatch, qualityScore, imageSimilarity,
  });

  return done(decide({
    text: read.text,
    ranked,
    confidence,
    topValue: top.apiCard.marketPrice,
    numberMatch,
    imageSimilarity,
  }));
}
