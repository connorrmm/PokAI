-- LICENCE COMPLIANCE FIX (2026-08-31).
--
-- tcgapi.dev's data licensing terms permit server-side caching -- "storage is
-- fine, redistribution is not" -- but draw one hard line on every plan:
--
--   "Don't operate an API, feed, file dump, or export that serves our pricing
--    data to third parties... Don't offer public, unrestricted downloads of
--    our records."
--   Practical test: "if someone could use your product instead of subscribing
--    to TCG API in order to get the data, that's not permitted."
--
-- Migrations 0001/0003 allowed the `anon` role to SELECT cards and card_prices.
-- Supabase exposes every table over PostgREST and the anon key is public by
-- design (it ships in the browser), so anyone holding it could have paginated
-- our entire cached card and price database straight out of Supabase. That is
-- exactly the "public, unrestricted download of our records" the licence
-- forbids, and it would have made PokAI a free proxy for a paid service.
--
-- Fix: catalog and prices become server-only. The client never reads them
-- directly; our own API reads them with the service_role key and returns only
-- what a screen needs. This is the "run a private backend" pattern the licence
-- explicitly permits.
--
-- User-owned tables (collections, scans, corrections) are untouched -- that is
-- our users' own data, not licensed data.

drop policy if exists "catalog sets readable"   on card_sets;
drop policy if exists "catalog cards readable"  on cards;
drop policy if exists "catalog prices readable" on card_prices;

-- RLS enabled with no policy = deny-all for anon and authenticated.
-- service_role bypasses RLS, so the server keeps full access.

-- Belt and braces: revoke the underlying grants too, so this cannot silently
-- reopen if someone later adds a policy without thinking about the licence.
revoke all on public.cards       from anon, authenticated;
revoke all on public.card_prices from anon, authenticated;
revoke all on public.card_sets   from anon, authenticated;
revoke all on public.card_prices_latest from anon, authenticated;

-- Verified after applying, with real rows present so "0 rows" could not be a
-- false pass:
--   anon          -> cards        blocked (42501)
--   anon          -> card_prices  blocked (42501)
--   authenticated -> cards        blocked (42501)
--   authenticated -> card_prices  blocked (42501)
--   service_role  -> card_prices  readable (intended)
