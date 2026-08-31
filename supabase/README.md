# Database

Live project: `yycsgtsvkhguzihyxtur` (region `us-east-2`, Postgres 17).
Schema applied 2026-08-31. These files are the source of truth — if you change
the database, add a migration here too, or the next person will be working from
a lie.

- `0001_catalog.sql` — cards, sets, prices, sync audit. Public read, server write.
- `0002_users_rls.sql` — profiles, collections, scans, corrections. Private per user.

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

## Known advisor notices

- `sync_runs` has RLS on and no policy. **Intentional** — the job log is
  server-only and should be invisible to clients.
- `rls_auto_enable` is flagged as a public SECURITY DEFINER function. It is
  Supabase's own platform safeguard, not ours, and it is an event-trigger
  function that cannot meaningfully be invoked over REST. Left alone.
