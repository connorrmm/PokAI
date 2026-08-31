-- Realign the schema to the ACTUAL tcgapi.dev response shape, observed from a
-- real API call on 2026-08-31 rather than guessed from documentation.
-- Safe to drop and recreate: every table was empty, nothing had shipped.
-- Supersedes the catalog half of 0001 and the table definitions in 0002.
--
-- What the original guess got wrong:
--   * card ids are integers (e.g. 21939), not strings like 'base1-4'
--   * a card carries set_name as plain text; sets are a separate endpoint
--   * prices arrive embedded in the search response, not from a separate call
--   * the provider supplies its own price_updated_at, which is NOT the same
--     fact as when we fetched it -- both are kept, see card_prices below
--
-- Verified response shape (GET /v1/search?q=charizard&game=pokemon):
--   id, name, clean_name, number, rarity, tcgplayer_id, product_type,
--   foil_only, total_listings, game_name, game_slug, set_name, printing,
--   market_price, low_price, median_price, lowest_with_shipping,
--   price_updated_at, image_url

drop table if exists corrections cascade;
drop table if exists scans cascade;
drop table if exists collections cascade;
drop view  if exists card_prices_latest cascade;
drop table if exists card_prices cascade;
drop table if exists cards cascade;
drop table if exists card_sets cascade;

create table card_sets (
  id bigint primary key,                     -- tcgapi set id
  game_slug text not null default 'pokemon',
  name text not null, code text, card_count integer,
  release_date date, image_url text,
  source text not null default 'tcgapi.dev',
  synced_at timestamptz not null default now()
);

create table cards (
  id bigint primary key,                     -- tcgapi card id, e.g. 21939
  tcgplayer_id bigint,                       -- upstream TCGPlayer product id
  set_id bigint references card_sets(id) on delete set null,
  name text not null, clean_name text,
  number text,                               -- e.g. '025/185'
  rarity text,
  printing text,                             -- e.g. 'Normal', 'Holofoil'
  product_type text,                         -- 'Cards' vs sealed product
  game_slug text not null default 'pokemon',
  set_name text,                             -- denormalised: search returns it
  foil_only boolean not null default false,
  image_url text,
  -- true when the printed number exceeds the set total (e.g. 196/131);
  -- almost always the chase card. Computed during sync, not supplied.
  is_secret boolean not null default false,
  source text not null default 'tcgapi.dev',
  synced_at timestamptz not null default now()
);
create index cards_name_idx on cards (lower(name));
create index cards_clean_idx on cards (clean_name);
create index cards_set_idx on cards (set_id);
create index cards_number_idx on cards (number);
create index cards_tcgplayer_idx on cards (tcgplayer_id);

-- Append-only price history.
--
-- Two timestamps, deliberately. source_updated_at is when the PROVIDER says
-- the price was true; fetched_at is when WE pulled it. Different facts --
-- conflating them is how an app quietly shows a stale number as current.
-- The UI shows source_updated_at.
create table card_prices (
  id bigserial primary key,
  card_id bigint not null references cards(id) on delete cascade,
  printing text not null default 'Normal',
  currency text not null default 'USD',
  market_price numeric(12,2), low_price numeric(12,2),
  median_price numeric(12,2), lowest_with_shipping numeric(12,2),
  total_listings integer,
  source text not null default 'tcgapi.dev',
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now()
);
create index card_prices_lookup_idx on card_prices (card_id, printing, fetched_at desc);

create view card_prices_latest as
select distinct on (card_id, printing)
  card_id, printing, currency, market_price, low_price, median_price,
  lowest_with_shipping, total_listings, source, source_updated_at, fetched_at
from card_prices order by card_id, printing, fetched_at desc;
alter view card_prices_latest set (security_invoker = true);

create table collections (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id bigint not null references cards(id),
  quantity integer not null default 1 check (quantity > 0),
  condition text, acquired_at timestamptz, notes text,
  created_at timestamptz not null default now()
);
create index collections_user_idx on collections (user_id);

create table scans (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text, model_output jsonb, confidence numeric(5,2),
  chosen_card_id bigint references cards(id),  -- null = unresolved, never a guess
  auto_accepted boolean not null default false,
  error_detail text, created_at timestamptz not null default now()
);
create index scans_user_idx on scans (user_id, created_at desc);

create table corrections (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id bigint references scans(id) on delete cascade,
  predicted_card_id bigint references cards(id),
  correct_card_id bigint not null references cards(id),
  created_at timestamptz not null default now()
);
create index corrections_pair_idx on corrections (predicted_card_id, correct_card_id);

alter table card_sets enable row level security;
alter table cards enable row level security;
alter table card_prices enable row level security;
alter table collections enable row level security;
alter table scans enable row level security;
alter table corrections enable row level security;

create policy "catalog sets readable"   on card_sets   for select to anon, authenticated using (true);
create policy "catalog cards readable"  on cards       for select to anon, authenticated using (true);
create policy "catalog prices readable" on card_prices for select to anon, authenticated using (true);

create policy "own collection read"   on collections for select to authenticated using ((select auth.uid()) = user_id);
create policy "own collection insert" on collections for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own collection update" on collections for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own collection delete" on collections for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own scans read"   on scans for select to authenticated using ((select auth.uid()) = user_id);
create policy "own scans insert" on scans for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own scans update" on scans for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own scans delete" on scans for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own corrections read"   on corrections for select to authenticated using ((select auth.uid()) = user_id);
create policy "own corrections insert" on corrections for insert to authenticated with check ((select auth.uid()) = user_id);
