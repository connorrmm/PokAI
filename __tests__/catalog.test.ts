/**
 * Tests for filling our own card catalog.
 *
 * This function exists because `cards` was empty while four foreign keys
 * pointed at it, so "Add to my collection" failed every time and the
 * collections table had zero rows -- the feature had never worked once.
 * If this quietly stops writing, that returns, and it returns silently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ApiCard } from '../lib/scanner/types';

const upserts: Array<{ table: string; rows: unknown[]; opts?: unknown }> = [];
const inserts: Array<{ table: string; rows: unknown[] }> = [];
let latestPrices: Array<Record<string, unknown>> = [];
let failOn: string | null = null;

vi.mock('../lib/supabase/server', () => ({
  admin: () => ({
    from(table: string) {
      return {
        upsert(rows: unknown[], opts?: unknown) {
          upserts.push({ table, rows, opts });
          return Promise.resolve({ error: failOn === table ? { message: 'nope' } : null });
        },
        insert(rows: unknown[]) {
          inserts.push({ table, rows });
          return Promise.resolve({ error: failOn === table ? { message: 'nope' } : null });
        },
        select() {
          return { in: () => Promise.resolve({ data: latestPrices, error: null }) };
        },
      };
    },
  }),
}));

const { cacheCards } = await import('../lib/catalog');

const card = (over: Partial<ApiCard> = {}): ApiCard => ({
  id: 100, name: 'Flareon', number: '013/131', rarity: 'Rare',
  setName: 'SV: Prismatic Evolutions', printing: 'Normal', imageUrl: 'http://img',
  marketPrice: 0.33, priceUpdatedAt: '2026-09-04T00:00:00Z',
  set: { name: null }, images: { small: null, large: null }, ...over,
} as ApiCard);

beforeEach(() => {
  upserts.length = 0; inserts.length = 0; latestPrices = []; failOn = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('cacheCards', () => {
  it('writes the card so a collection can reference it', async () => {
    await cacheCards([card()]);
    const cards = upserts.find((u) => u.table === 'cards');
    expect(cards).toBeDefined();
    expect((cards!.rows[0] as Record<string, unknown>).id).toBe(100);
    expect(cards!.opts).toEqual({ onConflict: 'id' });
  });

  it('flags a secret rare, where the number exceeds the set total', async () => {
    // Two of the seven cards tested so far are this shape (190/165, 088/086),
    // and both are among the more valuable in their sets.
    await cacheCards([card({ id: 1, number: '190/165' }), card({ id: 2, number: '013/131' })]);
    const rows = upserts.find((u) => u.table === 'cards')!.rows as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.id === 1)!.is_secret).toBe(true);
    expect(rows.find((r) => r.id === 2)!.is_secret).toBe(false);
  });

  it('does not choke on a card with no number', async () => {
    await cacheCards([card({ number: null })]);
    const rows = upserts.find((u) => u.table === 'cards')!.rows as Array<Record<string, unknown>>;
    expect(rows[0].is_secret).toBe(false);
  });

  it('records a price observation the first time it sees one', async () => {
    await cacheCards([card()]);
    const prices = inserts.find((i) => i.table === 'card_prices');
    expect(prices).toBeDefined();
    expect((prices!.rows[0] as Record<string, unknown>).market_price).toBe(0.33);
  });

  it('does not re-record a price that has not changed', async () => {
    // One Flareon search returns fifty cards. Appending every time turns the
    // price series into the same measurement recorded over and over.
    latestPrices = [{
      card_id: 100, printing: 'Normal', market_price: 0.33,
      source_updated_at: '2026-09-04T00:00:00Z',
    }];
    await cacheCards([card()]);
    expect(inserts.find((i) => i.table === 'card_prices')).toBeUndefined();
  });

  it('records a price that HAS changed', async () => {
    latestPrices = [{
      card_id: 100, printing: 'Normal', market_price: 0.28,
      source_updated_at: '2026-09-03T00:00:00Z',
    }];
    await cacheCards([card()]);
    expect(inserts.find((i) => i.table === 'card_prices')).toBeDefined();
  });

  it('never writes a null price as an observation of "worth nothing"', async () => {
    await cacheCards([card({ marketPrice: null })]);
    expect(inserts.find((i) => i.table === 'card_prices')).toBeUndefined();
    // The card itself is still cached, so it can still be collected.
    expect(upserts.find((u) => u.table === 'cards')).toBeDefined();
  });

  it('skips rows with no usable id or name rather than writing junk', async () => {
    await cacheCards([
      card({ id: 100 }),
      card({ id: NaN as unknown as number }),
      card({ id: 101, name: '' }),
    ]);
    const rows = upserts.find((u) => u.table === 'cards')!.rows;
    expect(rows).toHaveLength(1);
  });

  it('does nothing at all for an empty list', async () => {
    await cacheCards([]);
    expect(upserts).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('never throws when the catalog write fails', async () => {
    // A scan that found the right card must not fail because our bookkeeping
    // could not be written. The user got their answer.
    failOn = 'cards';
    await expect(cacheCards([card()])).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});
