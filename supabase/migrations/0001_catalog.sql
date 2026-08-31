-- PokAI card catalog. Synced from tcgapi.dev by a scheduled job.
-- Public read-only; only the server (service_role) writes.
-- Applied to project yycsgtsvkhguzihyxtur on 2026-08-31.

create table if not exists card_sets (
  id text primary key, name text not null, series text,
  printed_total integer, total integer, release_date date,
  symbol_url text, logo_url text,
  source text not null default 'tcgapi.dev',
  synced_at timestamptz not null default now()
);

create table if not exists cards (
  id text primary key,
  set_id text references card_sets(id) on delete cascade,
  name text not null, number text, rarity text, supertype text,
  subtypes text[], artist text, image_small text, image_large text,
  -- true when the card number exceeds the set total (e.g. 196/131).
  -- Almost always the chase card -- see docs/CATALOG.md.
  is_secret boolean not null default false,
  source text not null default 'tcgapi.dev',
  synced_at timestamptz not null default now()
);
create index if not exists cards_name_idx on cards (lower(name));
create index if not exists cards_set_idx on cards (set_id);
create index if not exists cards_number_idx on cards (number);

-- Append-only price history. Never overwrite: "never fabricate a price"
-- requires knowing when each number was true.
create table if not exists card_prices (
  id bigserial primary key,
  card_id text not null references cards(id) on delete cascade,
  variant text not null default 'normal',
  currency text not null default 'USD',
  market numeric(12,2), low numeric(12,2), mid numeric(12,2), high numeric(12,2),
  source text not null,
  fetched_at timestamptz not null default now()
);
create index if not exists card_prices_lookup_idx on card_prices (card_id, variant, fetched_at desc);

create or replace view card_prices_latest as
select distinct on (card_id, variant)
  card_id, variant, currency, market, low, mid, high, source, fetched_at
from card_prices order by card_id, variant, fetched_at desc;
alter view card_prices_latest set (security_invoker = true);

create table if not exists sync_runs (
  id bigserial primary key, kind text not null,
  status text not null default 'running', records integer not null default 0,
  error text, started_at timestamptz not null default now(), finished_at timestamptz
);

alter table card_sets enable row level security;
alter table cards enable row level security;
alter table card_prices enable row level security;
alter table sync_runs enable row level security;

create policy "catalog sets readable"   on card_sets   for select to anon, authenticated using (true);
create policy "catalog cards readable"  on cards       for select to anon, authenticated using (true);
create policy "catalog prices readable" on card_prices for select to anon, authenticated using (true);
-- sync_runs deliberately has NO policy: server-only, invisible to clients.
