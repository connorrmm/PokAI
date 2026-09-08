-- A collection must not depend on our cache being populated.
--
-- Migration 0005 established the principle: collections, scans and corrections
-- each carry a first-party SNAPSHOT of the card's identity, so provider rows
-- can be purged while a user's collection survives. It dropped NOT NULL and
-- made deletion set the link to null.
--
-- But it left the foreign keys in place, which enforce the opposite thing:
-- a row cannot be written unless the card ALREADY EXISTS in the cache. So
-- "Add to my collection" failed with a foreign-key violation for every card
-- the catalog had not yet seen -- which, with an empty catalog, was every card
-- there is. The feature had never worked once.
--
-- Keeping the constraint means a user cannot own a card until we have cached
-- it, which makes their own collection hostage to our bookkeeping and to a
-- third party's data. That is backwards. The snapshot is the truth about what
-- someone owns; card_id is a soft link used to enrich it with art and a price
-- when we happen to have them.
--
-- Nothing is lost. ON DELETE SET NULL never applied to a table we only ever
-- add to, the snapshot columns already carry identity, and the enrichment join
-- is a LEFT JOIN in effect -- a missing card was always handled.

alter table collections  drop constraint if exists collections_card_id_fkey;
alter table scans        drop constraint if exists scans_chosen_card_id_fkey;
alter table corrections  drop constraint if exists corrections_predicted_card_id_fkey;
alter table corrections  drop constraint if exists corrections_correct_card_id_fkey;

-- The indexes that made those joins fast are kept deliberately: the link still
-- exists and is still used, it simply is not enforced.
create index if not exists collections_card_idx  on collections (card_id);
create index if not exists scans_card_idx        on scans (chosen_card_id);
