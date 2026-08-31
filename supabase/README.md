# Database

Live project: `yycsgtsvkhguzihyxtur` (region `us-east-2`, Postgres 17).
Schema applied 2026-08-31. These files are the source of truth — if you change
the database, add a migration here too, or the next person will be working from
a lie.

- `0001_catalog.sql` — first cut. **Superseded by 0003.**
- `0002_users_rls.sql` — profiles + user tables and their RLS policies. The
  `profiles` table and the signup trigger are still live from this file; its
  other table definitions are superseded by 0003.
- `0003_align_schema_with_tcgapi.sql` — **current.** Rebuilt against the real
  tcgapi.dev response shape after an actual API call, replacing what had been
  guessed from documentation.

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
