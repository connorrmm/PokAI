import { NextResponse } from 'next/server';
import { asUser, admin, bearerToken } from '@/lib/supabase/server';
import { loadCollection } from '@/lib/portfolio';

/**
 * The portfolio: what the collection is worth now, and what it has been worth.
 *
 * Recording happens HERE, on read, rather than on a schedule. Opening the
 * portfolio writes today's total. It means history only covers days the user
 * actually looked, which is honest and needs no cron job -- and the chart shows
 * the days it has rather than interpolating the ones it does not.
 *
 * The prototype faked all of this: a timer moved every card ±2% every 26
 * seconds and the sparkline was a hardcoded array. Product rule 2 forbids
 * inventing a price, and inventing a price MOVEMENT is the same lie with extra
 * steps.
 */
export const runtime = 'nodejs';

function notConfigured() {
  return NextResponse.json(
    {
      error: {
        message: 'The portfolio is unavailable because this deployment is missing Supabase keys. '
          + 'Add NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and '
          + 'SUPABASE_SERVICE_ROLE_KEY in Vercel → Settings → Environment Variables, then redeploy.',
        code: 'supabase_not_configured',
      },
    },
    { status: 503 },
  );
}

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return NextResponse.json(
      { error: { message: 'Sign in to see your portfolio.', code: 'not_signed_in' } },
      { status: 401 },
    );
  }

  const db = asUser(token);
  if (!db) return notConfigured();

  // A null admin client means the catalog cannot be read, so every card would
  // come back unpriced and the total would read $0.00 -- indistinguishable
  // from a genuinely worthless collection. Say so instead.
  const sb = admin();
  if (!sb) return notConfigured();

  const result = await loadCollection(db, sb);
  if ('error' in result) {
    return NextResponse.json(
      { error: { message: result.error, code: result.code } }, { status: result.status },
    );
  }
  const { items, totals } = result;

  const { data: userRes } = await db.auth.getUser();
  const userId = userRes?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: { message: 'Sign in to see your portfolio.', code: 'not_signed_in' } },
      { status: 401 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  // Record today BEFORE reading history, so today's point is in the series and
  // the chart's right-hand end always matches the number displayed above it.
  //
  // Only when something is actually priced. Writing a zero for a collection
  // whose prices merely failed to load would carve a crash into the chart that
  // never happened, and it would be indistinguishable from a real one later.
  let recorded = false;
  if (totals.valued > 0) {
    const { error } = await db.from('portfolio_snapshots').upsert({
      user_id: userId,
      day: today,
      total_value_usd: totals.marketValue,
      card_count: totals.cards,
      unpriced_count: totals.unpriced,
    }, { onConflict: 'user_id,day' });
    if (!error) recorded = true;
    else console.warn('Could not record today\'s portfolio value:', error.message);
  }

  const { data: history } = await db
    .from('portfolio_snapshots')
    .select('day, total_value_usd, card_count, unpriced_count')
    .order('day', { ascending: false })
    .limit(90);

  const series = (history ?? [])
    .map((h) => ({
      day: h.day as string,
      value: Number(h.total_value_usd),
      cards: h.card_count as number,
      unpriced: h.unpriced_count as number,
    }))
    .reverse();

  // Change since the previous RECORDED day, not "today" in the abstract. The
  // label says which day it is measured against, because a change since three
  // days ago presented as "today" is a small lie that compounds.
  //
  // Gated on `recorded`. Without that gate, a run where prices failed to load
  // reports a total of $0.00 and compares it against a real baseline, printing
  // "▼ down $480.00 (100%)" -- a crash that never happened. That is precisely
  // the fabrication the comment above the snapshot write claims to prevent,
  // and skipping the write was not enough on its own: the compare had to be
  // skipped too.
  const previous = recorded && series.length >= 2 ? series[series.length - 2] : null;
  const change = previous
    ? {
        since: previous.day,
        absolute: Math.round((totals.marketValue - previous.value) * 100) / 100,
        percent: previous.value > 0
          ? Math.round(((totals.marketValue - previous.value) / previous.value) * 1000) / 10
          : null,
      }
    : null;

  return NextResponse.json({
    totals,
    change,
    // True when today's value could not be established, so the page can say so
    // rather than presenting an unpriced total as a real one.
    valuationUnavailable: totals.cards > 0 && totals.valued === 0,
    series,
    recorded,
    // Top holdings by total value, for the "what is actually carrying this
    // collection" question a total alone cannot answer.
    top: [...items]
      .filter((i) => typeof i.marketPrice === 'number')
      .sort((a, b) => (b.marketPrice as number) * b.quantity - (a.marketPrice as number) * a.quantity)
      .slice(0, 5),
    itemCount: items.length,
  });
}
