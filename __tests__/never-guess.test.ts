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
import { numberMatchesCard, extractCardNumber } from '../lib/scanner/number';
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
