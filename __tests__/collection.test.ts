/**
 * Tests for the money paths: valuing a collection, and the totals a collector
 * reads as their portfolio.
 *
 * These exist because of a specific pattern. Every defect found in this
 * project on 2026-09-04 -- a fabricated $480 crash, a $0.00 portfolio served
 * with a 200, "Add to my collection" that had never once worked -- passed a
 * clean typecheck, a clean build and a full test suite. The tests covered the
 * pieces. The bugs were in the seams, and nothing tested a seam.
 *
 * A fake Supabase client is used rather than a real one, because what needs
 * proving here is how OUR code behaves when the database answers in each of
 * the ways it really can: fine, empty, or broken.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadCollection, totalsOf, type CollectionItem } from '../lib/portfolio';

type Row = Record<string, unknown>;

/**
 * The narrow slice of the supabase-js builder our code actually uses:
 * `.from(t).select(...).order(...)` and `.from(t).select(...).in(...)`,
 * both awaited as `{ data, error }`.
 */
function fakeDb(tables: Record<string, { data: Row[] | null; error?: { message: string; code?: string } }>) {
  const seen: string[] = [];
  const client = {
    seen,
    from(table: string) {
      seen.push(table);
      const result = tables[table] ?? { data: [], error: undefined };
      const thenable = {
        select: () => thenable,
        order: () => thenable,
        in: () => thenable,
        eq: () => thenable,
        limit: () => thenable,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: result.data, error: result.error ?? null }).then(resolve),
      };
      return thenable;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any;
}

const collectionRow = (over: Row = {}): Row => ({
  id: 1, card_id: 100, quantity: 1, condition: null, notes: null,
  created_at: '2026-09-04T00:00:00Z',
  card_name: 'Flareon', card_set_name: 'SV: Prismatic Evolutions', card_number: '013/131',
  ...over,
});

describe('totalsOf', () => {
  const item = (over: Partial<CollectionItem> = {}): CollectionItem => ({
    id: 1, cardId: 100, quantity: 1, condition: null, notes: null,
    addedAt: '', name: 'Flareon', setName: 'A', number: '1', rarity: null,
    imageUrl: null, marketPrice: 1, ...over,
  });

  it('multiplies price by quantity', () => {
    expect(totalsOf([item({ marketPrice: 2.5, quantity: 4 })]).marketValue).toBe(10);
  });

  it('counts unpriced cards separately instead of treating them as worthless', () => {
    // Rule 2. A card with no price is NOT a card worth $0, and a total that
    // silently absorbs it understates a collection without saying so.
    const t = totalsOf([
      item({ id: 1, marketPrice: 10, quantity: 1 }),
      item({ id: 2, marketPrice: null, quantity: 3 }),
    ]);
    expect(t.marketValue).toBe(10);
    expect(t.cards).toBe(4);
    expect(t.valued).toBe(1);
    expect(t.unpriced).toBe(3);
  });

  it('reports an all-unpriced collection as worth nothing KNOWN, not nothing', () => {
    const t = totalsOf([item({ marketPrice: null, quantity: 2 })]);
    expect(t.marketValue).toBe(0);
    expect(t.unpriced).toBe(2);
    // The caller can tell "no prices available" from "genuinely worthless"
    // only because valued is 0 while cards is not.
    expect(t.valued).toBe(0);
    expect(t.cards).toBe(2);
  });

  it('rounds money to cents rather than carrying float noise', () => {
    const t = totalsOf([
      item({ id: 1, marketPrice: 0.1, quantity: 1 }),
      item({ id: 2, marketPrice: 0.2, quantity: 1 }),
    ]);
    expect(t.marketValue).toBe(0.3);
  });
});

describe('loadCollection', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('joins catalog art and price onto the user rows', async () => {
    const db = fakeDb({ collections: { data: [collectionRow()] } });
    const sb = fakeDb({
      cards: { data: [{ id: 100, image_url: 'http://img', rarity: 'Rare' }] },
      card_prices_latest: { data: [{ card_id: 100, market_price: 0.33 }] },
    });
    const res = await loadCollection(db, sb);
    if ('error' in res) throw new Error(res.error);
    expect(res.items[0].marketPrice).toBe(0.33);
    expect(res.items[0].imageUrl).toBe('http://img');
    expect(res.totals.marketValue).toBe(0.33);
  });

  it('keeps the user snapshot when the card has been purged from the catalog', async () => {
    // Migration 0005: a collection must survive the cached catalog being
    // deleted, which the licence requires if the contract ever ends.
    const db = fakeDb({ collections: { data: [collectionRow({ card_id: null })] } });
    const sb = fakeDb({ cards: { data: [] }, card_prices_latest: { data: [] } });
    const res = await loadCollection(db, sb);
    if ('error' in res) throw new Error(res.error);
    expect(res.items[0].name).toBe('Flareon');
    expect(res.items[0].number).toBe('013/131');
    expect(res.items[0].marketPrice).toBeNull();
    expect(res.totals.unpriced).toBe(1);
  });

  it('does not invent a price when the catalog read fails', async () => {
    // This silently produced a $0.00 portfolio served with a 200 status.
    const db = fakeDb({ collections: { data: [collectionRow()] } });
    const sb = fakeDb({
      cards: { data: null, error: { message: 'permission denied' } },
      card_prices_latest: { data: null, error: { message: 'permission denied' } },
    });
    const res = await loadCollection(db, sb);
    if ('error' in res) throw new Error(res.error);
    expect(res.items[0].marketPrice).toBeNull();
    expect(res.totals.unpriced).toBe(1);
    expect(res.totals.valued).toBe(0);
    // And it must not stay silent about it.
    expect(console.warn).toHaveBeenCalled();
  });

  it('reports an expired token as 401, not 500', async () => {
    const db = fakeDb({ collections: { data: null, error: { message: 'JWT expired', code: 'PGRST301' } } });
    const res = await loadCollection(db, null);
    expect('error' in res && res.status).toBe(401);
  });

  it('reports a broken policy as 500, so it is not mistaken for a login problem', async () => {
    const db = fakeDb({ collections: { data: null, error: { message: 'permission denied for table collections' } } });
    const res = await loadCollection(db, null);
    expect('error' in res && res.status).toBe(500);
  });

  it('never reads the catalog with the user client', async () => {
    // The catalog is server-only for licence compliance (migration 0004), and
    // the user client cannot read it. Asking with the wrong client would
    // silently return nothing and look like an unpriced collection.
    const db = fakeDb({ collections: { data: [collectionRow()] } });
    const sb = fakeDb({ cards: { data: [] }, card_prices_latest: { data: [] } });
    await loadCollection(db, sb);
    expect(db.seen).toEqual(['collections']);
    expect(sb.seen).toContain('cards');
    expect(sb.seen).toContain('card_prices_latest');
  });

  it('does not query the catalog at all for an empty collection', async () => {
    const db = fakeDb({ collections: { data: [] } });
    const sb = fakeDb({ cards: { data: [] }, card_prices_latest: { data: [] } });
    const res = await loadCollection(db, sb);
    if ('error' in res) throw new Error(res.error);
    expect(res.items).toEqual([]);
    expect(sb.seen).toEqual([]);
  });
});
