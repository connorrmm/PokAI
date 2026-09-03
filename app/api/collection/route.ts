import { NextResponse } from 'next/server';
import { asUser, admin, bearerToken } from '@/lib/supabase/server';
import { loadCollection } from '@/lib/portfolio';

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

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return unauthorised();

  const db = asUser(token);
  if (!db) return notConfigured();

  const result = await loadCollection(db, admin());
  if ('error' in result) {
    // Rule 4: the real reason. An expired token and a broken policy are very
    // different problems and only the message tells them apart.
    return NextResponse.json(
      { error: { message: result.error, code: result.code } }, { status: result.status },
    );
  }
  return NextResponse.json(result);
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
