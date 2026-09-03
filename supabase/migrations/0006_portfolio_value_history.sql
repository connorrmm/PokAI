-- Value tracking over time (Tier 1 MVP item 6).
--
-- The prototype's portfolio screen showed "▲ $312.10 (1.7%) today" above a
-- sparkline. Both were FABRICATED: a timer moved every card by a random ±2%
-- every 26 seconds (app.html:3357-3371) and the sparkline was a fixed seed
-- array that never reflected anything. Porting that as-is would have shipped
-- invented financial data, which product rule 2 forbids outright.
--
-- Real history has to be recorded, so this records it. One row per user per
-- day holding what their collection was worth that day.
--
-- LICENCE NOTE. tcgapi.dev's terms require cached PRICES to be deleted within
-- 30 days if the contract ends, but state that we keep "your own derived
-- analytics". A user's collection total is exactly that: our own computation
-- over their own holdings, not a redistributable copy of anyone's price list.
-- Deliberately stored as a single total per day rather than per-card prices --
-- per-card price history would be a cached price series wearing a hat.

create table if not exists portfolio_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The day this total was true, in UTC. One row per user per day; a later
  -- snapshot on the same day overwrites it, so the figure is the most recent
  -- valuation of that day rather than whichever happened to be written first.
  day date not null,
  total_value_usd numeric(14,2) not null,
  card_count integer not null default 0,
  -- Cards held that day with no price available. Without this a total that
  -- omitted half the collection would be indistinguishable from a real drop,
  -- and the chart would show a crash that never happened.
  unpriced_count integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

create index if not exists portfolio_snapshots_user_idx
  on portfolio_snapshots (user_id, day desc);

alter table portfolio_snapshots enable row level security;

create policy "own snapshots read"   on portfolio_snapshots
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own snapshots insert" on portfolio_snapshots
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own snapshots update" on portfolio_snapshots
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
