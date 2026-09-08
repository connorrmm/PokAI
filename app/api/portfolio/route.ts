import { NextResponse } from 'next/server';
import { asUser, admin, bearerToken, missingSupabaseEnv, envSources } from '@/lib/supabase/server';
import { buildInfo, buildTag } from '@/lib/build';
import { loadCollection } from '@/lib/portfolio';
import { cardsByIds } from '@/lib/tcgapi';
import { computeCollectionScore, achievements } from '@/lib/score';

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
  if (!token) {
    return NextResponse.json(
      { error: { message: 'Sign in to see your portfolio.', code: 'not_signed_in' } },
      { status: 401 },
    );
  }

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
    return NextResponse.json(
      { error: { message: result.error, code: result.code } }, { status: result.status },
    );
  }
  const { items, totals, priceProblem } = result;

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

  const scoreCards = items.map((i) => ({
    rarity: i.rarity, setName: i.setName, quantity: i.quantity,
  }));

  return NextResponse.json({
    totals,
    change,
    score: computeCollectionScore({ totalValue: totals.marketValue, cards: scoreCards }),
    achievements: achievements({
      cardCount: totals.cards, totalValue: totals.marketValue, cards: scoreCards,
    }),
    // "Recent pulls" in the prototype: the cards most recently added.
    recent: items.slice(0, 8),
    // Every holding, for the rarity breakdown -- it has to cover the whole
    // collection, not just the eight most recent, or the proportions lie.
    all: items.map((i) => ({
      rarity: i.rarity, quantity: i.quantity, marketPrice: i.marketPrice,
    })),
    // True when today's value could not be established, so the page can say so
    // rather than presenting an unpriced total as a real one.
    valuationUnavailable: totals.cards > 0 && totals.valued === 0,
    // Non-null ONLY when a card actually went unpriced, and then it says why.
    // Previously this reported the missing server key even when every card had
    // a price, which is a banner that cries wolf.
    pricesUnavailable: priceProblem,
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
