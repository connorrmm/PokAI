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
import { rankCandidatesByName, numberMatchesCard } from '../lib/scanner/rank';
import type { ApiCard, RankedCandidate } from '../lib/scanner/types';

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
  it('treats a missing number as unknown, not as a mismatch', () => {
    expect(numberMatchesCard(null, card(1, 'Charizard', '4/102'))).toBeNull();
    expect(numberMatchesCard('4/102', card(1, 'Charizard'))).toBeNull();
  });
  it('ignores leading zeros', () => {
    expect(numberMatchesCard('025/185', card(1, 'Charizard', '25/185'))).toBe(true);
  });
  it('rejects a genuine mismatch', () => {
    expect(numberMatchesCard('4/102', card(1, 'Charizard', '25/185'))).toBe(false);
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
