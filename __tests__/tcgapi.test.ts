/**
 * The search term used to price a card the catalog does not have.
 *
 * Names are stored inconsistently in the live database -- it holds both
 * "Iron Leaves ex" and "Kangaskhan ex - 190/165" -- because a scan sometimes
 * appends the collector number to the name it saves. A term built from the raw
 * name would search for the number twice, which is how a search for a real
 * card returns nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

/**
 * Pricing a card by id, and the fallback when that does not carry a price.
 *
 * This is pinned because the first version shipped broken in a way that
 * reported NOTHING. `/v1/cards/{id}` is a card DETAIL endpoint -- it can answer
 * with the card while putting prices somewhere our normaliser does not read
 * (per condition, per printing, in a history array). The fallback only ran when
 * the lookup returned no card at all, so it never ran, and Sterling's portfolio
 * showed three cards, zero errors and $0.00.
 */
describe('cardsByIds', () => {
  const KANGASKHAN = { id: 21876, name: 'Kangaskhan ex', number: '190/165' };

  /** A response body, as fetch would hand it back. */
  const json = (body: unknown) => ({
    ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
  }) as unknown as Response;

  let realFetch: typeof globalThis.fetch;
  let realKey: string | undefined;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    realKey = process.env.TCGAPI_KEY;
    process.env.TCGAPI_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.TCGAPI_KEY;
    else process.env.TCGAPI_KEY = realKey;
  });

  it('falls back to search when the card detail carries no price', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('/cards/21876')) {
        // The card, with its prices somewhere we do not read.
        return json({ id: 21876, name: 'Kangaskhan ex', number: '190/165', prices: { near_mint: 41.2 } });
      }
      return json({ data: [{ id: 21876, name: 'Kangaskhan ex', number: '190/165', market_price: 41.2 }] });
    }) as unknown as typeof globalThis.fetch;

    const { cardsByIds } = await import('../lib/tcgapi');
    const { cards, errors } = await cardsByIds([KANGASKHAN]);

    expect(urls.some((u) => u.includes('/search?'))).toBe(true);
    expect(cards).toHaveLength(1);           // one entry, not the card twice
    expect(cards[0].marketPrice).toBe(41.2);
    expect(errors).toEqual([]);              // it worked, so nothing to report
  });

  it('never takes another card\'s price from the search results', async () => {
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/cards/')) return json({ id: 21876, name: 'Kangaskhan ex' });
      // Every other print of the same Pokemon, at very different prices.
      return json({ data: [
        { id: 11111, name: 'Kangaskhan ex', number: '115/165', market_price: 2.31 },
        { id: 22222, name: 'Kangaskhan ex', number: '198/165', market_price: 310.0 },
      ] });
    }) as unknown as typeof globalThis.fetch;

    const { cardsByIds } = await import('../lib/tcgapi');
    const { cards, errors } = await cardsByIds([KANGASKHAN]);

    // Rather no price than the wrong one. $2.31 and $310.00 are both this
    // card's name and neither is this card.
    expect(cards.every((c) => typeof c.marketPrice !== 'number')).toBe(true);
    expect(errors.join(' ')).toContain('21876');
  });

  it('says so when nothing can be priced, rather than going quiet', async () => {
    globalThis.fetch = (async () => json({ data: [] })) as unknown as typeof globalThis.fetch;
    const { cardsByIds } = await import('../lib/tcgapi');
    const { errors } = await cardsByIds([KANGASKHAN]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('uses the direct lookup when it does carry a price, without searching', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      return json({ id: 21876, name: 'Kangaskhan ex', market_price: 41.2 });
    }) as unknown as typeof globalThis.fetch;

    const { cardsByIds } = await import('../lib/tcgapi');
    const { cards, errors } = await cardsByIds([KANGASKHAN]);
    expect(cards[0].marketPrice).toBe(41.2);
    expect(urls.some((u) => u.includes('/search?'))).toBe(false);
    expect(errors).toEqual([]);
  });
});
