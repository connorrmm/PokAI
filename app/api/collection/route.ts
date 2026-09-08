import { NextResponse } from 'next/server';
import { asUser, admin, bearerToken, missingSupabaseEnv, envSources } from '@/lib/supabase/server';
import { buildInfo, buildTag } from '@/lib/build';
import { loadCollection } from '@/lib/portfolio';
import { cardsByIds } from '@/lib/tcgapi';
import { parseCondition } from '@/lib/condition';

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

  /**
   * Say which CLIENT this could not build, not just which variable is absent.
   *
   * This function only ever runs because `asUser` returned null, and asUser
   * needs the URL and the anon key -- NOT the service-role key. So a message
   * naming only SUPABASE_SERVICE_ROLE_KEY here has always been impossible from
   * this code path, which is exactly what made it so confusing to receive: it
   * could only have come from a build old enough to still gate on the catalog.
   * Naming the two variables that actually matter here, and stamping the build,
   * makes that unmistakable next time.
   */
  const forSignedInUser = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']
    .filter((n) => missing.includes(n));

  const message = forSignedInUser.length
    ? `This deployment cannot reach Supabase as you: ${forSignedInUser.join(' and ')} `
      + `${forSignedInUser.length > 1 ? 'are' : 'is'} not set. Add ${forSignedInUser.length > 1 ? 'them' : 'it'} `
      + 'in Vercel → Settings → Environment Variables and redeploy — NEXT_PUBLIC_ variables are '
      + `baked in at build time, so a redeploy is required.${buildTag()}`
    : `Supabase is configured but the client could not be created.${buildTag()}`;

  return NextResponse.json(
    {
      error: {
        message,
        code: 'supabase_not_configured',
        // Everything absent, including the catalog key -- which does NOT cause
        // this error and never has. Listed so a report is complete, not so it
        // is blamed.
        missing,
        needed_here: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
        env_source: envSources(),
        build: buildInfo(),
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

  // A null admin client means card art and prices cannot be read. That is a
  // real degradation and it is reported -- but it must NOT stop the page.
  //
  // Refusing outright meant a missing server key showed an error where a
  // collection should be, which is a worse failure than showing the cards
  // without prices: the cards are the user's own data and were never the part
  // that needed the catalog. Rule 2 is satisfied by saying prices are
  // unavailable, not by hiding everything.
  const sb = admin();
  const result = await loadCollection(db, sb, cardsByIds);
  if ('error' in result) {
    // Rule 4: the real reason. An expired token and a broken policy are very
    // different problems and only the message tells them apart.
    return NextResponse.json(
      { error: { message: result.error, code: result.code } }, { status: result.status },
    );
  }
  return NextResponse.json({
    ...result,
    // Named so the UI can explain a priceless collection rather than
    // presenting it as a worthless one.
    // Non-null ONLY when a card actually went unpriced, and then it says why.
    pricesUnavailable: result.priceProblem,
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
    condition?: string | null;
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
    // Validated, never passed through raw: condition is part of the key that
    // separates one holding from another, so free text would let the same card
    // fragment into unlimited rows.
    p_condition: parseCondition(body.condition),
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
