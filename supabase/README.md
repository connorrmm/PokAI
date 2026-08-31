# Database

Live project: `yycsgtsvkhguzihyxtur` (region `us-east-2`, Postgres 17).
Schema applied 2026-08-31. These files are the source of truth — if you change
the database, add a migration here too, or the next person will be working from
a lie.

- `0001_catalog.sql` — first cut. **Superseded by 0003.**
- `0002_users_rls.sql` — profiles + user tables and their RLS policies. The
  `profiles` table and the signup trigger are still live from this file; its
  other table definitions are superseded by 0003.
- `0003_align_schema_with_tcgapi.sql` — rebuilt against the real tcgapi.dev
  response shape after an actual API call.
- `0004_licence_compliance_catalog_server_only.sql` — closes client access to the
  cached catalog and prices. See below; not optional.
- `0005_survive_provider_data_purge.sql` — **current.** Lets provider data be
  deleted without destroying users' collections.

## A user's collection survives losing the data provider

The licence is scoped to an active subscription: on cancellation we must delete
cached catalog and price rows within 30 days, while keeping our own users' data.

As originally built those two requirements were in direct conflict — collections
pointed at `cards.id` with a NOT NULL foreign key, so purging the catalog would
have deleted every user's collection.

Now each collection, scan and correction stores a first-party snapshot of the
card's identity (`card_name`, `card_set_name`, `card_number`) and its catalog
link is optional. `purge_provider_data()` performs the deletion.

Tested rather than assumed: seeded a card, a price and a user's collection row,
ran the purge, and confirmed the catalog and prices were gone while the
collection survived with `card_id` NULL and its snapshot intact — Charizard /
SWSH04: Vivid Voltage / 025/185, quantity 2.

## The catalog is server-only, and must stay that way

tcgapi.dev's licence permits caching their data in our database but forbids
"public, unrestricted downloads of our records" and operating anything that
"serves our pricing data to third parties."

The original policies let the `anon` role read `cards` and `card_prices`.
Because Supabase publishes every table over PostgREST and the anon key ships
inside the browser, that combination meant anyone could have paged our whole
price database out of Supabase — a licence breach, and effectively a free proxy
to a paid service.

**Rule going forward: no client role ever gets SELECT on `cards`, `card_prices`,
or `card_sets`.** Our API reads them with the service_role key and returns only
what a given screen needs. If a future migration adds a policy to those tables,
that is a bug unless the licence has changed.

Verified with real rows present, so an empty table could not fake a pass:

| Role | Table | Result |
|---|---|---|
| anon | cards / card_prices | blocked (42501) |
| authenticated | cards / card_prices | blocked (42501) |
| service_role (our API) | card_prices | readable — intended |

## What the guessed schema got wrong

Worth recording, because the lesson generalises: three of four assumptions
taken from documentation were wrong, and one real API call found all of them.

| Assumed | Actually |
|---|---|
| Card ids look like `base1-4` (text) | Integers, e.g. `21939` |
| Sets are a linked object on the card | Card carries `set_name` as plain text |
| Prices need a separate lookup | Embedded in the search response |
| One timestamp per price is enough | Provider supplies its own `price_updated_at`, distinct from when we fetched |

That last row became a schema change rather than a footnote. `card_prices` now
stores **both** `source_updated_at` (when the provider says the price was true)
and `fetched_at` (when we pulled it). Showing the first is what makes "never
fabricate a price" honest; conflating the two is how an app quietly presents a
stale number as current.

## Security was tested, not assumed

Row-level security was verified by inserting real rows for two users and then
querying as each role. Results:

| Test | Result |
|---|---|
| Logged-out visitor reads the card catalog | allowed (intended — it's public reference data) |
| Logged-out visitor reads collections/scans (2 rows present) | **0 rows** |
| User A reads collections while user B has data | **only A's own row** |
| User A inserts a row owned by user B | **blocked by RLS** |

Re-run these after any policy change. An RLS mistake is silent — nothing errors,
data is just visible to the wrong person.

These were re-run after the 0003 rebuild (which dropped and recreated every
table) and all four still pass. The repo migration file was also diffed against
the live database's actual columns — they match.

## Known advisor notices

- `sync_runs` has RLS on and no policy. **Intentional** — the job log is
  server-only and should be invisible to clients.
- `rls_auto_enable` is flagged as a public SECURITY DEFINER function. It is
  Supabase's own platform safeguard, not ours, and it is an event-trigger
  function that cannot meaningfully be invoked over REST. Left alone.
