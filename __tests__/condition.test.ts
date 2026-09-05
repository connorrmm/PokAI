import { describe, it, expect } from 'vitest';
import { CONDITIONS, parseCondition } from '../lib/condition';

describe('parseCondition', () => {
  it('accepts each of the five standard grades', () => {
    for (const c of CONDITIONS) expect(parseCondition(c)).toBe(c);
  });

  it('treats an unset condition as unset, never as Near Mint', () => {
    // Defaulting to the best grade inflates every collection that never
    // touches the field (docs/PRODUCT.md item 9).
    expect(parseCondition(null)).toBeNull();
    expect(parseCondition(undefined)).toBeNull();
    expect(parseCondition('')).toBeNull();
  });

  it('rejects free text, which would fragment one card into unlimited rows', () => {
    // Condition is part of the key separating holdings, so anything not
    // exactly one of the five must not reach the database.
    expect(parseCondition('near mint')).toBeNull();
    expect(parseCondition('NM')).toBeNull();
    expect(parseCondition('Mint')).toBeNull();
    expect(parseCondition({ toString: () => 'Near Mint' })).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseCondition('  Lightly Played  ')).toBe('Lightly Played');
  });
});
