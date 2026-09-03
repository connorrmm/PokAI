import { NextResponse } from 'next/server';
import { readCardFromImage } from '@/lib/vision';
import { searchCards, TcgApiError } from '@/lib/tcgapi';
import { rankCandidatesByName } from '@/lib/scanner/rank';
import { resolveCandidates, SIGNAL_CERTAINTY_FLOOR } from '@/lib/scanner/resolve';
import { computeConfidence, autoAcceptFloorFor, isClearlyBest } from '@/lib/scanner/confidence';
import { decide } from '@/lib/scanner/decide';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import type { ApiCard } from '@/lib/scanner/types';

/**
 * Vision-based identification.
 *
 * The model reads the card; the catalog decides which print it is; the
 * never-guess rule decides whether we accept or ask. Reading and deciding stay
 * separate on purpose -- swapping the reader must not be able to weaken the
 * rule that protects the user.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Trust the WEAKER of the model's certainty about what it read and how well
 *  that reading matches a real card. Either being low is a reason for caution. */
function scoreFor(read: { confidence: number }, nameScore: number): number {
  return Math.min(read.confidence, nameScore);
}

function usageOf(v: { inputTokens: number; outputTokens: number; elapsedMs: number }) {
  return { inputTokens: v.inputTokens, outputTokens: v.outputTokens, elapsedMs: v.elapsedMs };
}

export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req), 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { message: 'Too many scans. Please wait a moment.', code: 'rate_limited' } },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  let body: {
    image?: string;
    numberCrops?: { left: string; right: string } | null;
    mediaType?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: 'Body must be JSON', code: 'bad_request' } }, { status: 400 });
  }

  const image = (body.image || '').replace(/^data:image\/[a-z+]+;base64,/, '');
  if (!image) {
    return NextResponse.json({ error: { message: 'Missing image', code: 'bad_request' } }, { status: 400 });
  }
  if (image.length > 8_000_000) {
    return NextResponse.json(
      { error: { message: 'Image too large. It should be downscaled before upload.', code: 'too_large' } },
      { status: 413 },
    );
  }
  const mediaType = (['image/jpeg', 'image/png', 'image/webp'].includes(body.mediaType || '')
    ? body.mediaType : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp';

  try {
    const vision = await readCardFromImage(image, mediaType, {
      numberCrops: body.numberCrops ?? null,
    });
    const read = vision.read;

    if (!read.is_pokemon_card) {
      return NextResponse.json({
        outcome: { ok: false, reason: 'not_a_card', text: '' }, vision: read, usage: usageOf(vision),
      });
    }
    if (!read.name) {
      return NextResponse.json({
        outcome: { ok: false, reason: 'no_text', text: '' }, vision: read, usage: usageOf(vision),
      });
    }

    // An uncertain name should WIDEN the search, never narrow it to a guess.
    const queries = [read.name, ...read.alternate_names].slice(0, 4);
    const seen = new Set<string>();
    const cards: ApiCard[] = [];
    for (const q of queries) {
      try {
        for (const c of await searchCards(q, 40)) {
          const k = String(c.id);
          if (!seen.has(k)) { seen.add(k); cards.push(c); }
        }
      } catch (e) {
        console.warn(`[identify] search failed for "${q}":`, e instanceof Error ? e.message : e);
      }
    }

    if (cards.length === 0) {
      return NextResponse.json({
        outcome: { ok: false, reason: 'no_match', text: read.name }, vision: read, usage: usageOf(vision),
      });
    }

    const resolved = resolveCandidates({
      ranked: rankCandidatesByName(cards, read.name),
      number: read.number,
      numberConfidence: read.number_confidence,
      setName: read.set_name,
      setConfidence: read.set_confidence,
      holoPattern: read.holo_pattern,
    });
    const { ranked, numberMatch, uniquelyResolved, counts } = resolved;

    const top = ranked[0];
    const confidence = computeConfidence({
      nameScore: scoreFor(read, top.score),
      numberMatch,
      qualityScore: read.legibility === 'clear' ? 95 : read.legibility === 'partial' ? 80 : 65,
    });

    const outcome = decide({
      text: read.name, ranked, confidence,
      topValue: ranked[0].apiCard.marketPrice, numberMatch, uniquelyResolved,
    });

    return NextResponse.json({
      outcome, vision: read,
      diagnostics: {
        model: vision.model,
        autoAcceptFloor: autoAcceptFloorFor(top.apiCard.marketPrice),
        clearlyBest: isClearlyBest(ranked),
        uniquelyResolved,
        numberConfidence: read.number_confidence,
        setConfidence: read.set_confidence,
        signalCertaintyFloor: SIGNAL_CERTAINTY_FLOOR,
        numberMatchCount: counts.numberMatches,
        setMatchCount: counts.setMatches,
        setTotalMatchCount: counts.setTotalMatches,
        patternMatchCount: counts.patternMatches,
        holoPattern: read.holo_pattern,
        queriesTried: queries,
        candidatesFound: cards.length,
      },
      usage: usageOf(vision),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    const status = e instanceof TcgApiError ? (e.status >= 500 ? 502 : e.status)
      : message.includes('ANTHROPIC_API_KEY') ? 500 : 502;
    console.error('[/api/identify] failed:', message);
    return NextResponse.json({ error: { message, code: 'identify_failed' } }, { status });
  }
}
