import { NextResponse } from 'next/server';
import { asUser, admin, bearerToken } from '@/lib/supabase/server';

/**
 * Scan history (Tier 1 MVP item 7) and corrections (item 8).
 *
 * Both are written from the same moment, because they are the same event seen
 * twice: what the scanner said, and what the card turned out to be.
 *
 * docs/PRODUCT.md, under "continuous improvement": when someone fixes a
 * misidentification, that correction is data about which cards the scanner
 * confuses. It costs nothing to capture now and cannot be recovered later --
 * every candidate list tapped through before this existed is gone.
 *
 * Only recorded for signed-in users, because scans.user_id is NOT NULL and a
 * scan belongs to somebody. A signed-out scan still works; it just leaves no
 * trace, which is the honest behaviour rather than a silent failure.
 */
export const runtime = 'nodejs';

function unauthorised() {
  return NextResponse.json(
    { error: { message: 'Sign in to keep your scan history.', code: 'not_signed_in' } },
    { status: 401 },
  );
}
function notConfigured() {
  return NextResponse.json(
    {
      error: {
        message: 'Scan history is unavailable because this deployment has no Supabase keys.',
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

  const { data, error } = await db
    .from('scans')
    .select('id, created_at, confidence, auto_accepted, chosen_card_id, error_detail, model_output, card_name, card_set_name, card_number')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    const status = /jwt|token|expired/i.test(error.message) ? 401 : 500;
    return NextResponse.json({ error: { message: error.message, code: error.code } }, { status });
  }

  const rows = data ?? [];
  const ids = rows.map((r) => r.chosen_card_id).filter((v): v is number => typeof v === 'number');
  const art = new Map<number, string | null>();
  if (ids.length) {
    // The catalog is server-only for licence compliance, so card art can only
    // be read here, never by the browser.
    const sb = admin();
    if (sb) {
      const { data: cards } = await sb.from('cards').select('id, image_url').in('id', ids);
      for (const c of cards ?? []) art.set(c.id, c.image_url ?? null);
    }
  }

  return NextResponse.json({
    items: rows.map((r) => {
      const read = (r.model_output ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        at: r.created_at,
        confidence: r.confidence === null ? null : Number(r.confidence),
        autoAccepted: r.auto_accepted,
        cardId: r.chosen_card_id,
        // The first-party snapshot: what the user ended up with, kept even if
        // the cached catalog row is later purged (migration 0005).
        name: r.card_name,
        setName: r.card_set_name,
        number: r.card_number,
        imageUrl: r.chosen_card_id != null ? art.get(r.chosen_card_id) ?? null : null,
        errorDetail: r.error_detail,
        readName: typeof read.name === 'string' ? read.name : null,
        readNumber: typeof read.number === 'string' ? read.number : null,
        candidateCount: typeof read.candidateCount === 'number' ? read.candidateCount : null,
        corrected: read.corrected === true,
      };
    }),
  });
}

interface ScanBody {
  /** What the scanner read, kept small on purpose -- never the photo. */
  read?: { name?: string | null; number?: string | null; notes?: string | null } | null;
  confidence?: number | null;
  autoAccepted?: boolean;
  candidateCount?: number | null;
  /** The card the scan settled on, if any. Null while unresolved. */
  cardId?: number | null;
  cardName?: string | null;
  cardSetName?: string | null;
  cardNumber?: string | null;
  /** The scanner's own top guess, when the user chose something else. */
  predictedCardId?: number | null;
  predictedCardName?: string | null;
  errorDetail?: string | null;
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return unauthorised();
  const db = asUser(token);
  if (!db) return notConfigured();

  let body: ScanBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { message: 'Could not read the request body.', code: 'bad_json' } }, { status: 400 },
    );
  }

  const { data: userRes } = await db.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId) return unauthorised();

  const cardId = typeof body.cardId === 'number' && Number.isFinite(body.cardId) ? body.cardId : null;
  const predictedId = typeof body.predictedCardId === 'number' && Number.isFinite(body.predictedCardId)
    ? body.predictedCardId : null;

  // A correction is a chosen card that differs from what the scanner led with.
  // Recorded on the scan itself as well as in `corrections`, so history can
  // show it without a join.
  const corrected = cardId !== null && predictedId !== null && cardId !== predictedId;

  const { data, error } = await db
    .from('scans')
    .insert({
      user_id: userId,
      // chosen_card_id stays null while a scan is unresolved -- the
      // "never guess" case where candidates were shown and nothing picked.
      // Storing null rather than a guess is the point (migration 0002).
      chosen_card_id: cardId,
      confidence: typeof body.confidence === 'number' ? body.confidence : null,
      auto_accepted: body.autoAccepted === true,
      error_detail: typeof body.errorDetail === 'string' ? body.errorDetail : null,
      card_name: body.cardName ?? null,
      card_set_name: body.cardSetName ?? null,
      card_number: body.cardNumber ?? null,
      model_output: {
        name: body.read?.name ?? null,
        number: body.read?.number ?? null,
        notes: body.read?.notes ?? null,
        candidateCount: body.candidateCount ?? null,
        corrected,
      },
    })
    .select('id')
    .single();

  if (error) {
    const status = /jwt|token|expired/i.test(error.message) ? 401 : 500;
    return NextResponse.json({ error: { message: error.message, code: error.code } }, { status });
  }

  if (corrected) {
    const { error: cErr } = await db.from('corrections').insert({
      user_id: userId,
      scan_id: data.id,
      predicted_card_id: predictedId,
      correct_card_id: cardId,
      predicted_card_name: body.predictedCardName ?? null,
      correct_card_name: body.cardName ?? null,
    });
    // A failed correction must not fail the scan record. The history entry is
    // the user's; the correction is ours to learn from, and losing one is not
    // worth losing the other.
    if (cErr) console.warn('Could not record correction:', cErr.message);
  }

  return NextResponse.json({ ok: true, id: data.id, corrected });
}
