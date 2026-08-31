-- The licence's cancellation clause has a schema consequence:
--
--   "If you cancel or your account is terminated: stop serving provider-sourced
--    records to your users, and delete cached raw records (prices, history,
--    catalog rows sourced from us) within 30 days. You keep everything that's
--    genuinely yours: your user accounts, first-party transactions, your own
--    catalog mappings, your formulas, and derived analytics."
--
-- As built, a user's collection pointed at cards.id with a NOT NULL foreign key.
-- Purging the catalog would have destroyed every user's collection with it --
-- we could not have complied without deleting our own users' data, which is
-- exactly the part the licence says we keep.
--
-- Fix: collections, scans and corrections each carry a first-party SNAPSHOT of
-- the card's identity, taken when the user added it. The link to the cached
-- catalog becomes optional (ON DELETE SET NULL), so provider rows can be purged
-- while the user's collection survives intact.
--
-- This is also better product design regardless of the licence: a user's
-- collection is theirs, and should not evaporate because a vendor contract
-- lapsed.
--
-- Deliberately NOT snapshotted: prices. Those are the licensed records and must
-- actually go. Value history a user saw survives only as our own derived
-- analytics, which the licence permits.

alter table collections drop constraint if exists collections_card_id_fkey;
alter table collections alter column card_id drop not null;
alter table collections
  add constraint collections_card_id_fkey
  foreign key (card_id) references cards(id) on delete set null;
alter table collections
  add column if not exists card_name text,
  add column if not exists card_set_name text,
  add column if not exists card_number text;

alter table scans drop constraint if exists scans_chosen_card_id_fkey;
alter table scans
  add constraint scans_chosen_card_id_fkey
  foreign key (chosen_card_id) references cards(id) on delete set null;
alter table scans
  add column if not exists card_name text,
  add column if not exists card_set_name text,
  add column if not exists card_number text;

alter table corrections drop constraint if exists corrections_predicted_card_id_fkey;
alter table corrections drop constraint if exists corrections_correct_card_id_fkey;
alter table corrections alter column correct_card_id drop not null;
alter table corrections
  add constraint corrections_predicted_card_id_fkey
  foreign key (predicted_card_id) references cards(id) on delete set null;
alter table corrections
  add constraint corrections_correct_card_id_fkey
  foreign key (correct_card_id) references cards(id) on delete set null;
alter table corrections
  add column if not exists predicted_card_name text,
  add column if not exists correct_card_name text;

-- One documented way to comply with the 30-day deletion clause. Deletes every
-- provider-sourced record and nothing else. Server-only.
create or replace function purge_provider_data()
returns table(deleted_prices bigint, deleted_cards bigint, deleted_sets bigint)
language plpgsql security definer set search_path = '' as $$
declare p bigint; c bigint; s bigint;
begin
  delete from public.card_prices; get diagnostics p = row_count;
  delete from public.cards;       get diagnostics c = row_count;
  delete from public.card_sets;   get diagnostics s = row_count;
  return query select p, c, s;
end $$;

revoke execute on function public.purge_provider_data() from anon, authenticated, public;

comment on function public.purge_provider_data() is
  'Licence compliance: deletes all tcgapi.dev-sourced records within the 30-day
   window required on cancellation. User collections, scans and corrections
   survive via their first-party card_name/card_set_name/card_number snapshots.';

-- Verified after applying: seeded a card, a price and a user collection row,
-- ran purge_provider_data(), and confirmed the catalog and prices were gone
-- while the collection row survived with card_id NULL and its snapshot intact
-- (Charizard / SWSH04: Vivid Voltage / 025/185, quantity 2).
