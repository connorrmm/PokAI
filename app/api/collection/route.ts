import { NextResponse } from 'next/server';
import { asUser, admin, bearerToken, missingSupabaseEnv } from '@/lib/supabase/server';
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
  const missing = missingSupabaseEnv();
  return NextResponse.json(
    {
      error: {
        // Name the variable that is actually absent. "Add these three" when
        // two are already set sends someone hunting for a problem that is not
        // there (rule 4).
        message: missing.length
          ? `This deployment is missing ${missing.join(' and ')} in its server environment. `
            + 'Add it in Vercel → Settings → Environment Variables, then redeploy — '
            + 'NEXT_PUBLIC_ variables are baked in at build time, so a redeploy is required.'
          : 'Supabase is configured but could not be reached.',
        code: 'supabase_not_configured',
        missing,
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

  // A null admin client means the catalog cannot be read, so every card would
  // come back unpriced and the total would read $0.00 -- indistinguishable
  // from a genuinely worthless collection. Say so instead.
  const sb = admin();
  if (!sb) return notConfigured();

  const result = await loadCollection(db, sb);
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

  // Number(null) is 0 and Number('') is 0, both of which passed isFinite and
  // then failed deep in the database as a foreign-key violation -- a 500 with
  // a raw Postgres message, when a 400 was already written right here.
  const raw = body.cardId;
  const cardId = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '')
    ? Number(raw) : NaN;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!Number.isInteger(cardId) || cardId <= 0 || !name) {
    return NextResponse.json(
      { error: { message: 'A card id and name are required to add a card.', code: 'bad_request' } },
      { status: 400 },
    );
  }
  const quantity = Number.isFinite(Number(body.quantity)) ? Math.max(1, Math.trunc(Number(body.quantity))) : 1;

  // One atomic upsert instead of read-then-write. Two quick taps used to race
  // each other and lose an increment, and could leave the same card on two
  // rows. The function (migration 0007) runs as the caller, so row-level
  // security applies exactly as it would to a direct insert.
  const { data: newId, error } = await db.rpc('add_card_to_collection', {
    p_card_id: cardId,
    p_quantity: quantity,
    p_name: name,
    p_set_name: typeof body.setName === 'string' ? body.setName : null,
    p_number: typeof body.number === 'string' ? body.number : null,
    p_condition: null,
  });

  if (error) {
    // A foreign-key failure here means the card is not in our catalog, which
    // is a real and specific problem -- say which, rather than passing a raw
    // Postgres message to a collector (rule 4).
    const missingCard = /foreign key|violates/i.test(error.message);
    return NextResponse.json({
      error: {
        message: missingCard
          ? 'That card is not in our card database yet, so it cannot be saved. '
            + 'Scan it again — looking a card up is what adds it.'
          : error.message,
        code: error.code,
      },
    }, { status: missingCard ? 409 : 500 });
  }

  return NextResponse.json({ ok: true, id: newId });
}
