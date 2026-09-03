import { NextResponse } from 'next/server';
import { readCardFromImage } from '@/lib/vision';
import { searchCards, TcgApiError } from '@/lib/tcgapi';
import { rankCandidatesByName } from '@/lib/scanner/rank';
import { numberMatchesCard, extractCardNumber, setTotalMatchesCard } from '@/lib/scanner/number';
import { computeConfidence, autoAcceptFloorFor, isClearlyBest } from '@/lib/scanner/confidence';
import { decide } from '@/lib/scanner/decide';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import type { ApiCard, RankedCandidate } from '@/lib/scanner/types';

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

  let body: { image?: string; bottomStrip?: string | null; mediaType?: string };
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
      bottomStrip: body.bottomStrip ?? null,
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

    let ranked: RankedCandidate[] = rankCandidatesByName(cards, read.name);
    // Track which candidates each independent signal points at, so their
    // INTERSECTION can be checked. Either alone is often ambiguous; together
    // they frequently identify one print exactly.
    let numberMatches: RankedCandidate[] = [];
    let setMatches: RankedCandidate[] = [];

    // The collector number is the strongest disambiguator when one name spans
    // dozens of prints. Applied across ALL tied candidates, not just the first.
    const extracted = read.number ? extractCardNumber(read.number) : null;
    let numberMatch: boolean | null = null;
    if (extracted) {
      const exact = ranked.filter((r) => numberMatchesCard(extracted, r.apiCard.number) === true);
      numberMatches = exact;
      if (exact.length === 1) {
        ranked = [exact[0], ...ranked.filter((r) => r !== exact[0])];
        numberMatch = true;
      } else if (exact.length > 1) {
        ranked = [...exact, ...ranked.filter((r) => !exact.includes(r))];
      } else {
        numberMatch = numberMatchesCard(extracted, ranked[0].apiCard.number);
      }
    }

    // When the full number matches nothing, fall back to the SET TOTAL.
    //
    // A Flareon read as `071/131` matched none of its 50 candidates, because
    // no Flareon carries 071. But four of them are `013/131`, and `/131` was
    // the one part of the read that every source agreed on. Ranking by the
    // total puts those four at the top instead of leaving the user to scroll
    // fifty near-identical rows.
    //
    // Reorder only. The list still contains every candidate, because a misread
    // total must never be able to hide the right card -- that is the dead end
    // the never-guess rule exists to prevent.
    let setTotalMatches: RankedCandidate[] = [];
    if (extracted && numberMatches.length === 0) {
      const byTotal = ranked.filter((r) => setTotalMatchesCard(extracted, r.apiCard.number) === true);
      if (byTotal.length > 0 && byTotal.length < ranked.length) {
        setTotalMatches = byTotal;
        ranked = [...byTotal, ...ranked.filter((r) => !byTotal.includes(r))];
      }
    }

    // Set name, when legible, breaks remaining ties.
    if (read.set_name) {
      const want = read.set_name.toLowerCase();
      const inSet = ranked.filter((r) => (r.apiCard.setName || '').toLowerCase().includes(want));
      setMatches = inSet;
      if (inSet.length > 0 && inSet.length < ranked.length) {
        ranked = [...inSet, ...ranked.filter((r) => !inSet.includes(r))];
      }
    }

    // Do the two signals agree on exactly one card? A real scan read
    // '075/131' and 'Prismatic Evolutions' correctly, but three different
    // cards carry that number, so the number alone could not settle it -- and
    // every print shares the name, so nothing else could either. Together they
    // leave exactly one.
    //
    // Only signals the model is actually SURE of may resolve a card outright.
    // A real scan reported the number as "tentative rather than confirmed" and
    // the set as "inferred from the artwork rather than a clearly legible set
    // symbol" -- treating those as facts would auto-accept one of three cards
    // sharing that number, at $5.81, $8.86 and $26.76. A quietly wrong card AND
    // a wrong valuation is exactly what the never-guess rule exists to prevent.
    const SIGNAL_CERTAINTY_FLOOR = 80;
    const numberIsSolid = read.number_confidence >= SIGNAL_CERTAINTY_FLOOR;
    const setIsSolid = read.set_confidence >= SIGNAL_CERTAINTY_FLOOR;

    let uniquelyResolved = false;

    // PATH A: the catalog corroborates the number.
    //
    // Exactly one card in the database carries the number we read, and it is a
    // card already matching the name. That is corroboration by an independent
    // source, which is stronger evidence than the model's opinion of itself.
    //
    // This replaces a gate that asked the model how sure it was. Measured
    // against cards read off the physical print, that self-report turned out
    // to be worse than useless -- it pointed the wrong way:
    //
    //   45% certain -> `190/165`  CORRECT
    //   65% certain -> `075/086`  wrong (really 015/086)
    //   75% certain -> `071/131`  wrong (really 013/131)
    //
    // The catalog check separated the same three perfectly: the correct read
    // matched exactly one card, and both wrong reads matched none. A misread
    // number rarely lands on a real print of the same Pokemon in a set of the
    // same size; a correct one always does.
    //
    // The residual risk is a misread that happens to be another real print of
    // the SAME Pokemon in the SAME set -- rare, and it usually fails safe,
    // because prints sharing a number (Master Ball and Poke Ball patterns)
    // match as a group rather than singly and so never reach this branch.
    // decide() still applies the auto-accept floor on top, which rises to 97
    // for valuable cards.
    if (numberMatches.length === 1) {
      uniquelyResolved = true;
      numberMatch = true;
    }

    // PATH B: number and set name independently agree on one card. Kept for
    // when a set symbol IS legible, which so far has never happened: set
    // confidence has been 15-35% on every scan ever recorded.
    else if (numberIsSolid && setIsSolid && numberMatches.length > 0 && setMatches.length > 0) {
      const both = numberMatches.filter((r) => setMatches.includes(r));
      if (both.length === 1) {
        ranked = [both[0], ...ranked.filter((r) => r !== both[0])];
        uniquelyResolved = true;
        numberMatch = true;
      }
    }

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
        numberMatchCount: numberMatches.length,
        setMatchCount: setMatches.length,
        setTotalMatchCount: setTotalMatches.length,
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
