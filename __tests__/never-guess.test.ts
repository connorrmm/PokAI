/**
 * Regression tests for PokAI's number-one product rule.
 *
 * Every test here corresponds to a real defect that shipped in the single-file
 * build and went unnoticed, because the rule lived inside an async function
 * that also drove the camera and the DOM and so could never be asserted on.
 *
 * If any of these fail, the app is lying to a collector about their card.
 */
import { describe, it, expect } from 'vitest';
import { decide } from '../lib/scanner/decide';
import {
  computeConfidence, autoAcceptFloorFor, isClearlyBest,
  AUTO_ACCEPT_FLOOR, AUTO_ACCEPT_FLOOR_HIGH_VALUE,
} from '../lib/scanner/confidence';
import { rankCandidatesByName } from '../lib/scanner/rank';
import {
  numberMatchesCard, extractCardNumber, setTotalMatchesCard, holoPatternOfCard,
} from '../lib/scanner/number';
import { sharpnessScore, clippedFraction, frameScore } from '../lib/scanner/sharpness';
import { resolveCandidates } from '../lib/scanner/resolve';
import type { ApiCard, RankedCandidate } from '../lib/scanner/types';
import {
  otsuThreshold, percentileRange, hammingDistance, hashSimilarity, toGray,
} from '../lib/scanner/image';

const card = (id: number, name: string, number?: string, marketPrice = 5): ApiCard =>
  ({ id, name, number, marketPrice });

const ranked = (n: number, score: number, name = 'Charizard'): RankedCandidate[] =>
  Array.from({ length: n }, (_, i) => ({ apiCard: card(i + 1, name, `${i + 1}/102`), score }));

describe('never guess: a low-confidence read must still offer candidates', () => {
  it('returns EVERY qualifying candidate, not none', () => {
    // THE SHIPPED BUG: this path returned no candidates field at all, so the
    // UI rendered no picker and the user hit a dead end.
    const out = decide({ text: 'charizard', ranked: ranked(12, 65), confidence: 41 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('low_confidence');
    expect('candidates' in out && out.candidates).toBeDefined();
    expect((out as any).candidates).toHaveLength(12);
  });

  it('never truncates the ambiguous list', () => {
    // THE OTHER SHIPPED BUG: capped at ranked.slice(0, 8).
    const out = decide({ text: 'pikachu', ranked: ranked(40, 95, 'Pikachu'), confidence: 78 });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('ambiguous');
    expect((out as any).candidates).toHaveLength(40);
  });

  it('a dead end is never the answer when any candidate qualifies', () => {
    for (const confidence of [0, 25, 41, 59, 60, 78, 91]) {
      const out = decide({ text: 'gyarados', ranked: ranked(5, 70), confidence });
      if (out.ok) continue;
      expect((out as any).candidates.length).toBeGreaterThan(0);
    }
  });
});

describe('never guess: ties are never auto-accepted', () => {
  it('refuses to auto-accept when several prints tie on name', () => {
    // Same Pokemon across many sets is the NORMAL case, not an edge case.
    const out = decide({ text: 'pikachu', ranked: ranked(6, 95, 'Pikachu'), confidence: 99 });
    expect(out.ok).toBe(false); // 99% confident of the NAME, not of the PRINT
  });

  it('accepts only when one candidate is clearly ahead', () => {
    const r: RankedCandidate[] = [
      { apiCard: card(1, 'Charizard', '4/102'), score: 95 },
      { apiCard: card(2, 'Charmeleon', '24/102'), score: 40 },
    ];
    const out = decide({ text: 'charizard', ranked: r, confidence: 95 });
    expect(out.ok).toBe(true);
  });
});

describe('valuable cards need stronger evidence', () => {
  it('raises the bar for cards worth $100 or more', () => {
    expect(autoAcceptFloorFor(5)).toBe(AUTO_ACCEPT_FLOOR);
    expect(autoAcceptFloorFor(100)).toBe(AUTO_ACCEPT_FLOOR_HIGH_VALUE);
    expect(autoAcceptFloorFor(2000)).toBe(AUTO_ACCEPT_FLOOR_HIGH_VALUE);
  });

  it('a score that accepts a cheap card does NOT accept an expensive one', () => {
    const r: RankedCandidate[] = [
      { apiCard: card(1, 'Charizard', '4/102', 2000), score: 95 },
      { apiCard: card(2, 'Charmeleon', '24/102'), score: 40 },
    ];
    expect(decide({ text: 'charizard', ranked: r, confidence: 94, topValue: 5 }).ok).toBe(true);
    expect(decide({ text: 'charizard', ranked: r, confidence: 94, topValue: 2000 }).ok).toBe(false);
  });
});

describe('confidence: the ceiling must be reachable', () => {
  it('a perfect read clears even the high-value bar', () => {
    // docs/SCANNER.md: an earlier formula made auto-accept mathematically
    // impossible -- a perfect match topped out at ~82 against a 92 threshold,
    // so the scanner asked the user to confirm every single card. Prove the
    // best realistic case actually clears the highest bar.
    const best = computeConfidence({
      nameScore: 95, numberMatch: true, qualityScore: 100, imageSimilarity: 90,
    });
    expect(best).toBeGreaterThanOrEqual(AUTO_ACCEPT_FLOOR_HIGH_VALUE);
  });

  it('a missing image signal never counts against a card', () => {
    const without = computeConfidence({ nameScore: 90, numberMatch: true, qualityScore: 85 });
    const withNull = computeConfidence({
      nameScore: 90, numberMatch: true, qualityScore: 85, imageSimilarity: null,
    });
    expect(withNull).toBe(without);
    // A LOW similarity must also not subtract -- it fails for benign reasons.
    const withLow = computeConfidence({
      nameScore: 90, numberMatch: true, qualityScore: 85, imageSimilarity: 10,
    });
    expect(withLow).toBe(without);
  });

  it('a contradicted card number is strong evidence against', () => {
    const ok = computeConfidence({ nameScore: 95, numberMatch: true });
    const bad = computeConfidence({ nameScore: 95, numberMatch: false });
    expect(bad).toBeLessThan(ok - 30);
  });

  it('stays within 0..100', () => {
    expect(computeConfidence({ nameScore: 0, numberMatch: false, qualityScore: 0 })).toBe(0);
    expect(computeConfidence({ nameScore: 100, numberMatch: true, qualityScore: 100, imageSimilarity: 99 })).toBe(100);
  });
});

describe('card number matching', () => {
  const n = (s: string) => extractCardNumber(s);

  it('extracts a printed number, stripping leading zeros', () => {
    expect(n('025/185')).toEqual({ num: '25', total: '185' });
    expect(n('noise 4 / 102 more noise')).toEqual({ num: '4', total: '102' });
    expect(n('no number here')).toBeNull();
  });

  it('treats a missing number as unknown, NOT as a mismatch', () => {
    // This matters: a mismatch costs 35 confidence points. Failing to read
    // small print is benign and must not be punished as contradiction.
    expect(numberMatchesCard(null, '4/102')).toBeNull();
    expect(numberMatchesCard(n('4/102'), null)).toBeNull();
    expect(numberMatchesCard(n('4/102'), undefined)).toBeNull();
  });

  it('ignores leading zeros on both sides', () => {
    expect(numberMatchesCard(n('025/185'), '25/185')).toBe(true);
    expect(numberMatchesCard(n('25/185'), '025/185')).toBe(true);
  });

  it('rejects a genuine mismatch', () => {
    expect(numberMatchesCard(n('4/102'), '25/185')).toBe(false);
  });

  it('same numerator but a DIFFERENT set total is a mismatch', () => {
    // Deliberate improvement on the prototype, which compared only the
    // numerator and so counted 25/185 as corroborating a card printed 25/102.
    // Those are different prints in different sets; treating that as evidence
    // FOR the card could push a wrong one over the auto-accept bar.
    expect(numberMatchesCard(n('25/185'), '25/102')).toBe(false);
    expect(numberMatchesCard(n('25/185'), '25/185')).toBe(true);
  });

  it('still matches when the card has no set total to compare', () => {
    expect(numberMatchesCard(n('25/185'), '25')).toBe(true);
  });
});

describe('ranking', () => {
  it('puts an exact name match top', () => {
    const r = rankCandidatesByName(
      [card(1, 'Blastoise'), card(2, 'Charizard'), card(3, 'Venusaur')],
      'charizard',
    );
    expect(r[0].apiCard.name).toBe('Charizard');
  });
  it('a tie is not clearly best', () => {
    expect(isClearlyBest(ranked(3, 95))).toBe(false);
    expect(isClearlyBest([{ apiCard: card(1, 'X'), score: 95 }])).toBe(true);
  });
});

describe('image maths', () => {
  it('otsu separates two clear clusters and lands in the gap', () => {
    // Dark ink at 20, light background at 220, nothing between.
    const hist = new Array(256).fill(0);
    hist[20] = 500; hist[220] = 500;
    const t = otsuThreshold(hist, 1000);
    expect(t).toBeGreaterThan(20);
    expect(t).toBeLessThan(220);
  });

  it('otsu takes the MIDPOINT of a plateau, not its first value', () => {
    // The prototype comment explains why: landing on a cluster edge
    // misclassifies borderline pixels under noise.
    const hist = new Array(256).fill(0);
    hist[10] = 100; hist[200] = 100;
    const t = otsuThreshold(hist, 200);
    expect(t).toBeGreaterThan(50);
    expect(t).toBeLessThan(160);
  });

  it('percentile clip ignores outliers at both ends', () => {
    const hist = new Array(256).fill(0);
    hist[0] = 1;      // a single black speck
    hist[255] = 1;    // a single glare pixel
    for (let v = 100; v <= 150; v++) hist[v] = 20;
    const total = 2 + 51 * 20;
    const { lo, hi } = percentileRange(hist, total, 0.02);
    expect(lo).toBeGreaterThanOrEqual(100);
    expect(hi).toBeLessThanOrEqual(150);
  });

  it('hamming returns null rather than a wrong number on unusable input', () => {
    expect(hammingDistance(null, '1010')).toBeNull();
    expect(hammingDistance('1010', null)).toBeNull();
    expect(hammingDistance('1010', '101')).toBeNull();
    expect(hammingDistance('1010', '1010')).toBe(0);
    expect(hammingDistance('1010', '0101')).toBe(4);
  });

  it('a null distance yields a null similarity, never 0', () => {
    // 0% similarity would look like strong evidence AGAINST the card.
    // Missing must stay missing.
    expect(hashSimilarity(null)).toBeNull();
    expect(hashSimilarity(0)).toBe(100);
    expect(hashSimilarity(32)).toBe(50);
  });

  it('grayscale uses Rec.601 luma', () => {
    expect(toGray(255, 255, 255)).toBe(255);
    expect(toGray(0, 0, 0)).toBe(0);
    expect(toGray(255, 0, 0)).toBe(76);
  });
});

describe('API response stays readable by the live single-file app', () => {
  // The app served at '/' is still the real product and consumes /api/search.
  // It reads set.name and images.small. Dropping those does not error -- it
  // silently degrades every card to "Unknown Set" with no art and no image
  // signal, which is exactly the kind of quiet regression this project keeps
  // getting bitten by. Lock the contract down.
  it('normaliseCard emits BOTH the flat and the nested shapes', async () => {
    const { normaliseCard } = await import('../lib/tcgapi-normalise');
    const raw = {
      id: 21939, name: 'Charizard', number: '025/185', rarity: 'Rare',
      set_name: 'SWSH04: Vivid Voltage', printing: 'Normal',
      market_price: 3.68, price_updated_at: '2026-08-31T07:18:27.028Z',
      image_url: 'https://product-images.tcgplayer.com/fit-in/400x400/226395.jpg',
    };
    const c = normaliseCard(raw as any);

    // New app reads these
    expect(c.setName).toBe('SWSH04: Vivid Voltage');
    expect(c.imageUrl).toContain('tcgplayer.com');
    expect(c.marketPrice).toBe(3.68);
    expect(c.priceUpdatedAt).toBe('2026-08-31T07:18:27.028Z');

    // Old app reads these
    expect(c.set?.name).toBe('SWSH04: Vivid Voltage');
    expect(c.images?.small).toContain('tcgplayer.com');
    expect(c.images?.large).toContain('tcgplayer.com');
  });
});

describe('two independent signals identify one print (real Eevee ex scan)', () => {
  // Reproduces an actual field scan. The vision model correctly read the name
  // "Eevee ex", the number "075/131" and the set "Prismatic Evolutions" from a
  // blurred, shadowed photo -- and the app still offered five options, because
  // every print shares the name (so nothing is ever "clearly best") and THREE
  // different cards carry the number 075/131.
  const eevee = (id: number, number: string, setName: string, price: number): ApiCard =>
    ({ id, name: 'Eevee ex', number, setName, marketPrice: price });

  const realScan: RankedCandidate[] = [
    { apiCard: eevee(1, '075/131', 'SV: Prismatic Evolutions', 5.81), score: 95 },
    { apiCard: eevee(2, '167/131', 'SV: Prismatic Evolutions', 181.32), score: 95 },
    { apiCard: eevee(3, '075/131', 'Prize Pack Series Cards', 26.76), score: 95 },
    { apiCard: eevee(4, '075/131', 'Miscellaneous Cards & Products', 8.86), score: 95 },
    { apiCard: eevee(5, '174', 'SV: Scarlet & Violet Promo Cards', 21.95), score: 95 },
  ];

  it('the number ALONE does not resolve it -- three cards share 075/131', () => {
    const n = extractCardNumber('075/131');
    const matches = realScan.filter((r) => numberMatchesCard(n, r.apiCard.number) === true);
    expect(matches).toHaveLength(3);
  });

  it('name score alone can never break the tie -- every print shares the name', () => {
    expect(isClearlyBest(realScan)).toBe(false);
  });

  it('WAS the observed bug: five options despite reading number and set', () => {
    const out = decide({ text: 'Eevee ex', ranked: realScan, confidence: 94, topValue: 5.81 });
    expect(out.ok).toBe(false);
    expect((out as any).candidates).toHaveLength(5);
  });

  it('IS the fix: number + set together identify one card, so it is accepted', () => {
    const out = decide({
      text: 'Eevee ex', ranked: realScan, confidence: 94, topValue: 5.81,
      numberMatch: true, uniquelyResolved: true,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.apiCard.id).toBe(1);
    expect(out.apiCard.setName).toBe('SV: Prismatic Evolutions');
  });

  it('resolving uniquely does NOT bypass the confidence bar', () => {
    // The signals agreeing is not permission to accept a weak read.
    const out = decide({
      text: 'Eevee ex', ranked: realScan, confidence: 70, topValue: 5.81,
      numberMatch: true, uniquelyResolved: true,
    });
    expect(out.ok).toBe(false);
  });

  it('resolving uniquely does NOT bypass the higher bar on a valuable card', () => {
    // 94 clears 92 for a cheap card but must NOT clear 97 for a $181 one.
    const cheap = decide({
      text: 'Eevee ex', ranked: realScan, confidence: 94, topValue: 5.81,
      numberMatch: true, uniquelyResolved: true,
    });
    const pricey = decide({
      text: 'Eevee ex', ranked: realScan, confidence: 94, topValue: 181.32,
      numberMatch: true, uniquelyResolved: true,
    });
    expect(cheap.ok).toBe(true);
    expect(pricey.ok).toBe(false);
  });
});

describe('a card is resolved only on signals the model is SURE of', () => {
  // Second real scan of the same Eevee ex. The model read the same number and
  // set, but reported them honestly as uncertain: "the collector number is very
  // small and blurred; it appears to read 075/131, so treat that as tentative
  // rather than confirmed" and "set inferred from the card's contents and
  // crystal/rainbow artwork rather than a clearly legible set symbol".
  //
  // Three cards share 075/131 at $5.81, $8.86 and $26.76. Accepting on a
  // guessed number would give a wrong card AND a wrong valuation, quietly.
  const eevee = (id: number, number: string, setName: string, price: number): ApiCard =>
    ({ id, name: 'Eevee ex', number, setName, marketPrice: price });

  const ranked5: RankedCandidate[] = [
    { apiCard: eevee(1, '075/131', 'SV: Prismatic Evolutions', 5.81), score: 95 },
    { apiCard: eevee(3, '075/131', 'Prize Pack Series Cards', 26.76), score: 95 },
    { apiCard: eevee(4, '075/131', 'Miscellaneous Cards & Products', 8.86), score: 95 },
  ];

  const FLOOR = 80;
  const resolves = (numberConf: number, setConf: number) => numberConf >= FLOOR && setConf >= FLOOR;

  it('a clearly READ number and set resolve the card', () => {
    expect(resolves(95, 90)).toBe(true);
    const out = decide({
      text: 'Eevee ex', ranked: ranked5, confidence: 94, topValue: 5.81,
      numberMatch: true, uniquelyResolved: true,
    });
    expect(out.ok).toBe(true);
  });

  it('a TENTATIVE number does not resolve it, however obvious the name', () => {
    expect(resolves(45, 90)).toBe(false);
    const out = decide({
      text: 'Eevee ex', ranked: ranked5, confidence: 94, topValue: 5.81,
      numberMatch: null, uniquelyResolved: false,
    });
    expect(out.ok).toBe(false);
    expect((out as any).candidates.length).toBeGreaterThan(1);
  });

  it('a set INFERRED from artwork does not resolve it either', () => {
    expect(resolves(95, 40)).toBe(false);
  });

  it('the user still gets every option when a signal is shaky', () => {
    const out = decide({
      text: 'Eevee ex', ranked: ranked5, confidence: 94, topValue: 5.81,
      uniquelyResolved: false,
    });
    if (out.ok) throw new Error('should not auto-accept on shaky signals');
    expect((out as any).candidates).toHaveLength(3);
  });
});

/**
 * The set total is the part of a collector number that survives a bad photo.
 * A real scan read `071/131` where the card is `013/131` -- numerator wrong,
 * total right. These lock in that the total is usable on its own, and that it
 * stays a RANKING signal rather than becoming a way to identify a card.
 */
describe('setTotalMatchesCard', () => {
  it('matches on the total even when the numerator is wrong', () => {
    expect(setTotalMatchesCard({ num: '71', total: '131' }, '013/131')).toBe(true);
  });

  it('rejects a card from a differently sized set', () => {
    expect(setTotalMatchesCard({ num: '71', total: '131' }, '136/165')).toBe(false);
  });

  it('ignores leading zeros on both sides', () => {
    expect(setTotalMatchesCard({ num: '13', total: '131' }, '013/0131')).toBe(true);
  });

  it('says nothing when the card has no total, rather than guessing', () => {
    expect(setTotalMatchesCard({ num: '13', total: '131' }, 'SWSH041')).toBe(null);
    expect(setTotalMatchesCard({ num: '13', total: '131' }, '167')).toBe(null);
  });

  it('says nothing when the read had no total', () => {
    expect(setTotalMatchesCard(null, '013/131')).toBe(null);
    expect(setTotalMatchesCard({ num: '13', total: '' }, '013/131')).toBe(null);
  });

  it('does not match a set total against a numerator', () => {
    // '131' appearing as a card NUMBER must not look like a set of 131 cards.
    expect(setTotalMatchesCard({ num: '13', total: '131' }, '131/198')).toBe(false);
  });
});

/**
 * A number is trusted because the CATALOG corroborates it, not because the
 * model says it is sure.
 *
 * Measured on cards read off the physical print, the model's self-reported
 * number certainty pointed the wrong way: 45% was correct, 65% and 75% were
 * both wrong. Matching against the database separated the same three
 * perfectly. These lock in the behaviour that follows from that.
 */
describe('a number is trusted when exactly one card carries it', () => {
  it('accepts when the read number matches exactly one candidate', () => {
    // Kangaskhan ex: 22 candidates all named the same, one carrying 190/165.
    const ranked = rankCandidatesByName([
      card(1, 'Kangaskhan ex', '190/165', 5.58),
      card(2, 'Kangaskhan ex', '115/165', 1.28),
      card(3, 'Kangaskhan EX', '78/106', 2.75),
    ], 'Kangaskhan ex');
    const out = decide({
      text: 'Kangaskhan ex', ranked, confidence: 99,
      topValue: 5.58, numberMatch: true, uniquelyResolved: true,
    });
    expect(out.ok).toBe(true);
  });

  it('still asks when tied names are the only signal', () => {
    // The same list WITHOUT a number match: names alone cannot separate them.
    const ranked = rankCandidatesByName([
      card(1, 'Kangaskhan ex', '190/165', 5.58),
      card(2, 'Kangaskhan ex', '115/165', 1.28),
    ], 'Kangaskhan ex');
    const out = decide({
      text: 'Kangaskhan ex', ranked, confidence: 99,
      topValue: 5.58, numberMatch: null, uniquelyResolved: false,
    });
    expect(out.ok).toBe(false);
    if (!out.ok && 'candidates' in out) expect(out.candidates?.length ?? 0).toBeGreaterThan(1);
  });

  it('does not accept a valuable card on a number match alone if confidence is short', () => {
    // A $600 card must clear 97, not 92. A unique number match does not
    // license skipping that -- the expensive mistakes are the expensive ones.
    const ranked = rankCandidatesByName([card(1, 'Flareon Star', '100/108', 600)], 'Flareon Star');
    const out = decide({
      text: 'Flareon Star', ranked, confidence: 94,
      topValue: 600, numberMatch: true, uniquelyResolved: true,
    });
    expect(out.ok).toBe(false);
  });

  it('offers the whole list, never a dead end, when it cannot resolve', () => {
    const ranked = rankCandidatesByName([
      card(1, 'Flareon', '013/131'), card(2, 'Flareon', '136/165'),
      card(3, 'Flareon', '026/185'),
    ], 'Flareon');
    const out = decide({
      text: 'Flareon', ranked, confidence: 59,
      topValue: 0.33, numberMatch: false, uniquelyResolved: false,
    });
    expect(out.ok).toBe(false);
    if (!out.ok && 'candidates' in out) expect(out.candidates?.length ?? 0).toBe(3);
  });
});

/**
 * Sharpness scoring. Two scans of the same card seconds apart differed only
 * in the photo -- one read the number perfectly, the next read nothing and
 * called the crop "out of focus and overexposed". Picking the best of several
 * frames needs a number that ranks them.
 */
describe('sharpnessScore', () => {
  const img = (w: number, h: number, fill: (x: number, y: number) => number): ImageData => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = fill(x, y);
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData;
  };

  it('scores a flat image at zero — no detail, nothing to read', () => {
    expect(sharpnessScore(img(20, 20, () => 128))).toBe(0);
  });

  it('scores a blown-out white region at zero, like the overexposed crop', () => {
    expect(sharpnessScore(img(20, 20, () => 255))).toBe(0);
  });

  it('scores hard edges above a soft gradient', () => {
    const stripes = sharpnessScore(img(40, 40, (x) => (x % 4 < 2 ? 0 : 255)));
    const gradient = sharpnessScore(img(40, 40, (x) => (x / 40) * 255));
    expect(stripes).toBeGreaterThan(gradient);
  });

  it('ranks a sharp edge above the same edge blurred', () => {
    const sharp = sharpnessScore(img(40, 40, (x) => (x < 20 ? 0 : 255)));
    // A ramp over 10px instead of a step: the same edge, out of focus.
    const blurred = sharpnessScore(img(40, 40, (x) =>
      x < 15 ? 0 : x > 25 ? 255 : ((x - 15) / 10) * 255));
    expect(sharp).toBeGreaterThan(blurred);
  });

  it('returns zero rather than throwing on a region too small to measure', () => {
    expect(sharpnessScore(img(2, 2, () => 100))).toBe(0);
  });
});

/**
 * Glare and blur are different problems with opposite fixes. A frame can be
 * pin-sharp and still be a mirror -- one real scan scored 499 for sharpness
 * and read nothing. Telling that user to hold steadier sends them to do more
 * of what already failed.
 */
describe('glare detection', () => {
  const img = (w: number, h: number, fill: (x: number, y: number) => number): ImageData => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = fill(x, y);
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData;
  };

  it('reports nothing clipped on an ordinary mid-tone region', () => {
    expect(clippedFraction(img(20, 20, () => 128))).toBe(0);
  });

  it('reports fully clipped on a blown-out white region', () => {
    expect(clippedFraction(img(20, 20, () => 255))).toBe(1);
  });

  it('measures a partial reflection', () => {
    // Left half blown out, right half normal.
    const f = clippedFraction(img(20, 20, (x) => (x < 10 ? 255 : 100)));
    expect(f).toBeCloseTo(0.5, 2);
  });

  it('ranks a sharp mirror below a sharp readable frame', () => {
    // Both are crisply edged; one is mostly blown out. This is the exact case
    // that scored 499 and read nothing.
    const readable = frameScore(img(40, 40, (x) => (x % 4 < 2 ? 0 : 200)));
    const mirror = frameScore(img(40, 40, (x, y) => (y < 34 ? 255 : x % 4 < 2 ? 0 : 200)));
    expect(mirror.sharpness).toBeGreaterThan(0);
    expect(mirror.score).toBeLessThan(readable.score);
  });

  it('does not count coloured foil that clips in one channel only', () => {
    const w = 10, h = 10;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255; data[i + 1] = 20; data[i + 2] = 20; data[i + 3] = 255;
    }
    const red = { width: w, height: h, data, colorSpace: 'srgb' } as ImageData;
    expect(clippedFraction(red)).toBe(0);
  });
});

/**
 * Four Prismatic Evolutions Flareons carry `013/131` -- plain, Master Ball,
 * Poke Ball and Cosmos Holo -- worth $0.33, $29.66, $2.16 and $1.31. No
 * collector number can separate them, so the foil pattern is the only signal
 * that can.
 */
describe('holoPatternOfCard', () => {
  it('reads the pattern out of the catalog name', () => {
    expect(holoPatternOfCard('Flareon (Master Ball Pattern)')).toBe('master_ball');
    expect(holoPatternOfCard('Flareon (Poke Ball Pattern)')).toBe('poke_ball');
    expect(holoPatternOfCard('Flareon - 013/131 (Cosmos Holo)')).toBe('cosmos');
  });

  it('treats an unadorned name as an ordinary print', () => {
    expect(holoPatternOfCard('Flareon')).toBe('none');
    expect(holoPatternOfCard('Kangaskhan ex - 190/165')).toBe('none');
  });

  it('does not mistake an unrecognised pattern for a plain card', () => {
    // A pattern we do not know about must not be ranked alongside plain
    // prints, or the cheap card gets offered for the expensive one.
    expect(holoPatternOfCard('Flareon (Cracked Ice Pattern)')).toBe('other');
  });

  it('handles a missing name without throwing', () => {
    expect(holoPatternOfCard(null)).toBe('none');
    expect(holoPatternOfCard(undefined)).toBe('none');
  });
});

/**
 * Regression tests for a CONFIDENTLY WRONG ANSWER that shipped.
 *
 * A Froakie was read as `088/086`. The app displayed `Froakie - 056/197
 * (Cosmos Holo)` at 99% and told the user "number and set agreed on exactly
 * one card". Those are not the same number.
 *
 * The collector-number step found the one card carrying `088/086` and put it
 * first; the foil-pattern step then re-sorted and moved a Cosmos Holo card to
 * the front; then "uniquely resolved" was computed from the still-true fact
 * that the number matched exactly one card, and the caller accepted whatever
 * sat at position 0. A ranking-only signal displaced an identifying one.
 *
 * This logic lived inside an HTTP handler and so could not be tested at all,
 * which is the same root cause the original single-file build had.
 */
describe('resolveCandidates', () => {
  const rank = (cards: ApiCard[], text: string) => rankCandidatesByName(cards, text);
  const base = {
    number: null as string | null, numberConfidence: 0,
    setName: null as string | null, setConfidence: 0,
    holoPattern: 'unknown' as const,
  };

  it('does not let the foil pattern displace a card the number identified', () => {
    // The exact Froakie shape: one card carries the number read, a DIFFERENT
    // card matches the foil pattern.
    const numbered = card(1, 'Froakie', '088/086', 1.0);
    const cosmos = card(2, 'Froakie - 056/197 (Cosmos Holo)', '056/197', 0.76);
    const out = resolveCandidates({
      ...base,
      ranked: rank([numbered, cosmos], 'Froakie'),
      number: '088/086',
      holoPattern: 'cosmos',
    });
    expect(out.ranked[0].apiCard.id).toBe(1);
    expect(out.uniquelyResolved).toBe(true);
  });

  it('withdraws the claim rather than identify a card the number contradicts', () => {
    // If anything ever does leave a mismatched card at the front, the verdict
    // must be dropped -- never left standing over whatever happens to be there.
    const cosmos = card(2, 'Froakie - 056/197 (Cosmos Holo)', '056/197', 0.76);
    const out = resolveCandidates({
      ...base,
      ranked: rank([cosmos], 'Froakie'),
      number: '088/086',
      holoPattern: 'cosmos',
    });
    expect(out.uniquelyResolved).toBe(false);
  });

  it('will not identify a card when several prints share the number', () => {
    // The four Prismatic Evolutions Flareons, $0.33 to $29.66. The number
    // corroborates the group and cannot choose within it.
    const out = resolveCandidates({
      ...base,
      ranked: rank([
        card(1, 'Flareon', '013/131', 0.33),
        card(2, 'Flareon (Master Ball Pattern)', '013/131', 29.66),
        card(3, 'Flareon (Poke Ball Pattern)', '013/131', 2.16),
        card(4, 'Flareon', '136/165', 0.31),
      ], 'Flareon'),
      number: '013/131',
      holoPattern: 'master_ball',
    });
    expect(out.uniquelyResolved).toBe(false);
    expect(out.counts.numberMatches).toBe(3);
  });

  it('ranks the foil pattern first when the number cannot choose', () => {
    // Same four cards: pattern may REORDER inside the group it cannot identify.
    const out = resolveCandidates({
      ...base,
      ranked: rank([
        card(1, 'Flareon', '013/131', 0.33),
        card(2, 'Flareon (Master Ball Pattern)', '013/131', 29.66),
      ], 'Flareon'),
      number: '013/131',
      holoPattern: 'master_ball',
    });
    expect(out.ranked[0].apiCard.id).toBe(2);
    expect(out.uniquelyResolved).toBe(false);
  });

  it('keeps every candidate in the list, whatever the reordering', () => {
    const cards = [
      card(1, 'Flareon', '013/131'), card(2, 'Flareon (Master Ball Pattern)', '013/131'),
      card(3, 'Flareon', '136/165'), card(4, 'Flareon - 167 (Cosmos Holo)', '167'),
    ];
    const out = resolveCandidates({
      ...base, ranked: rank(cards, 'Flareon'), number: '013/131', holoPattern: 'cosmos',
    });
    expect(out.ranked.length).toBe(4);
    expect(new Set(out.ranked.map((r) => r.apiCard.id))).toEqual(new Set([1, 2, 3, 4]));
  });

  it('falls back to the set total when the number matches nothing', () => {
    const out = resolveCandidates({
      ...base,
      ranked: rank([
        card(1, 'Flareon', '136/165'), card(2, 'Flareon', '013/131'),
      ], 'Flareon'),
      number: '071/131',
    });
    expect(out.ranked[0].apiCard.id).toBe(2);
    expect(out.uniquelyResolved).toBe(false);
    expect(out.counts.setTotalMatches).toBe(1);
  });
});
