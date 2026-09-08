/**
 * The search term used to price a card the catalog does not have.
 *
 * Names are stored inconsistently in the live database -- it holds both
 * "Iron Leaves ex" and "Kangaskhan ex - 190/165" -- because a scan sometimes
 * appends the collector number to the name it saves. A term built from the raw
 * name would search for the number twice, which is how a search for a real
 * card returns nothing.
 */
import { describe, it, expect } from 'vitest';
import { searchTermFor } from '../lib/tcgapi';

describe('searchTermFor', () => {
  it('strips a collector number the name already carries', () => {
    // Real rows from the live database on 2026-09-08.
    expect(searchTermFor({ name: 'Kangaskhan ex - 190/165', number: '190/165' }))
      .toBe('Kangaskhan ex 190/165');
    expect(searchTermFor({ name: 'Eevee ex - 075/131', number: '075/131' }))
      .toBe('Eevee ex 075/131');
  });

  it('leaves a plain name alone', () => {
    expect(searchTermFor({ name: 'Iron Leaves ex', number: '176/131' }))
      .toBe('Iron Leaves ex 176/131');
  });

  it('keeps a hyphen that is part of the name', () => {
    // Ho-Oh, Porygon-Z, Jangmo-o. Stripping on any hyphen would have wrecked
    // these, which is why the pattern requires a collector number after it.
    expect(searchTermFor({ name: 'Ho-Oh ex', number: '022/165' })).toBe('Ho-Oh ex 022/165');
    expect(searchTermFor({ name: 'Porygon-Z', number: null })).toBe('Porygon-Z');
  });

  it('has nothing to search for without a name', () => {
    expect(searchTermFor({ name: null, number: '190/165' })).toBeNull();
    expect(searchTermFor({ name: '   ', number: '190/165' })).toBeNull();
    expect(searchTermFor(undefined)).toBeNull();
  });
});
