import { NextResponse } from 'next/server';
import { asUser, admin, bearerToken } from '@/lib/supabase/server';

/**
 * A user's collection.
 *
 * Two clients, deliberately. Collection rows are read AS THE USER so
 * row-level security decides what they can see -- a mistake here exposes only
 * their own rows. Card names and prices are read with the service role,
 * because migration 0004 made the catalog server-only to comply with
 * tcgapi.dev's licence, and the browser genuinely cannot read it.
 */

export const runtime = 'nodejs';

function unauthorised() {
  return NextResponse.json(
    { error: { message: 'Sign in to see your collection.', code: 'not_signed_in' } },
    { status: 401 },
  );
}

function notConfigured() {
  return NextResponse.json(
    {
      error: {
        message: 'Collections are unavailable because this deployment has no Supabase keys. '
          + 'Add NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and '
          + 'SUPABASE_SERVICE_ROLE_KEY in Vercel → Settings → Environment Variables, '
          + 'then redeploy.',
        code: 'supabase_not_configured',
      },
    },
    { status: 503 },
  );
}

interface CollectionRow {
  id: number;
  card_id: number | null;
  quantity: number;
  condition: string | null;
  notes: string | null;
  created_at: string;
  card_name: string | null;
  card_set_name: string | null;
  card_number: string | null;
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return unauthorised();

  const db = asUser(token);
  if (!db) return notConfigured();

  const { data, error } = await db
    .from('collections')
    .select('id, card_id, quantity, condition, notes, created_at, card_name, card_set_name, card_number')
    .order('created_at', { ascending: false });

  if (error) {
    // Rule 4: the real reason. An expired token and a broken policy are very
    // different problems and only the message tells them apart.
    const status = /jwt|token|expired/i.test(error.message) ? 401 : 500;
    return NextResponse.json({ error: { message: error.message, code: error.code } }, { status });
  }

  const rows = (data ?? []) as CollectionRow[];

  // Enrich with live card data where the catalog still has the card. The
  // SNAPSHOT on each row is what the user actually owns and is always shown;
  // catalog data only adds art and a current price on top of it.
  const ids = rows.map((r) => r.card_id).filter((v): v is number => typeof v === 'number');
  const cards = new Map<number, { imageUrl: string | null; rarity: string | null; marketPrice: number | null }>();

  if (ids.length) {
    const sb = admin();
    if (sb) {
      const [{ data: cardRows }, { data: priceRows }] = await Promise.all([
        sb.from('cards').select('id, image_url, rarity').in('id', ids),
        sb.from('card_prices_latest').select('card_id, market_price').in('card_id', ids),
      ]);
      const priceOf = new Map<number, number | null>();
      for (const p of priceRows ?? []) {
        // Several printings can share a card. Keep the first, which the view
        // already orders by most recently fetched.
        if (!priceOf.has(p.card_id)) priceOf.set(p.card_id, p.market_price);
      }
      for (const c of cardRows ?? []) {
        cards.set(c.id, {
          imageUrl: c.image_url ?? null,
          rarity: c.rarity ?? null,
          marketPrice: priceOf.get(c.id) ?? null,
        });
      }
    }
  }

  const items = rows.map((r) => {
    const live = r.card_id != null ? cards.get(r.card_id) : undefined;
    return {
      id: r.id,
      cardId: r.card_id,
      quantity: r.quantity,
      condition: r.condition,
      notes: r.notes,
      addedAt: r.created_at,
      // The user's own snapshot, taken when they added it. Survives the card
      // being purged from the cached catalog (migration 0005).
      name: r.card_name,
      setName: r.card_set_name,
      number: r.card_number,
      rarity: live?.rarity ?? null,
      imageUrl: live?.imageUrl ?? null,
      // Rule 2: null means unavailable and must be SHOWN as unavailable.
      // Never a stale number presented as current.
      marketPrice: live?.marketPrice ?? null,
    };
  });

  const priced = items.filter((i) => typeof i.marketPrice === 'number');
  return NextResponse.json({
    items,
    // Reported alongside the total so a partial total is never mistaken for a
    // complete one -- a portfolio figure that quietly omits cards is worse
    // than no figure.
    totals: {
      cards: items.reduce((n, i) => n + i.quantity, 0),
      valued: priced.reduce((n, i) => n + i.quantity, 0),
      unpriced: items.reduce((n, i) => n + i.quantity, 0) - priced.reduce((n, i) => n + i.quantity, 0),
      marketValue: priced.reduce((n, i) => n + (i.marketPrice as number) * i.quantity, 0),
    },
  });
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return unauthorised();

  const db = asUser(token);
  if (!db) return notConfigured();

  let body: {
    cardId?: number | string;
    name?: string;
    setName?: string | null;
    number?: string | null;
    quantity?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { message: 'Could not read the request body.', code: 'bad_json' } }, { status: 400 },
    );
  }

  const cardId = Number(body.cardId);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!Number.isFinite(cardId) || !name) {
    return NextResponse.json(
      { error: { message: 'A card id and name are required to add a card.', code: 'bad_request' } },
      { status: 400 },
    );
  }
  const quantity = Number.isFinite(Number(body.quantity)) ? Math.max(1, Math.trunc(Number(body.quantity))) : 1;

  const { data: userRes } = await db.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId) return unauthorised();

  // Already own it? Add to the count rather than making a second row, so a
  // playset reads as "4x Flareon" and not four identical lines.
  const { data: existing, error: findErr } = await db
    .from('collections')
    .select('id, quantity')
    .eq('card_id', cardId)
    .limit(1);

  if (findErr) {
    return NextResponse.json({ error: { message: findErr.message, code: findErr.code } }, { status: 500 });
  }

  if (existing && existing.length) {
    const row = existing[0];
    const { error } = await db
      .from('collections')
      .update({ quantity: row.quantity + quantity })
      .eq('id', row.id);
    if (error) {
      return NextResponse.json({ error: { message: error.message, code: error.code } }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: row.id, quantity: row.quantity + quantity });
  }

  const { data, error } = await db
    .from('collections')
    .insert({
      user_id: userId,
      card_id: cardId,
      quantity,
      // The first-party snapshot migration 0005 exists for. Without these the
      // user's collection would be destroyed by a catalog purge, which is the
      // one thing the licence says is genuinely ours to keep.
      card_name: name,
      card_set_name: typeof body.setName === 'string' ? body.setName : null,
      card_number: typeof body.number === 'string' ? body.number : null,
    })
    .select('id, quantity')
    .single();

  if (error) {
    return NextResponse.json({ error: { message: error.message, code: error.code } }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data.id, quantity: data.quantity });
}
