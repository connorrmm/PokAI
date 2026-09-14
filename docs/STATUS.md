# Current status — what actually exists

**Last verified: 2026-09-14**, against commit `2465e72` on `main`, by running
the test suite, the type checker and the production build, and by querying the
live Supabase database.

Every claim here was checked. Where something could not be checked, it says so
and says why — see §8, which is the list of things this document does *not*
know.

> **The previous version of this file, verified 2026-08-31, was completely
> superseded.** It described a repository of two files with no build step, no
> package manager and no tests, and said nothing was deployed. All of that was
> true on the day it was written and none of it is true now. A correction log is
> at the bottom. If you are reading an older copy of this file anywhere, discard
> it.

---

## 1. The repository

Public repo: `github.com/connorrmm/PokAI`, default branch `main`.

A Next.js 15 application: ~60 TypeScript and TSX source files, 9 SQL migrations,
8 test files.

```
app/            5 pages, 7 API routes
components/     13 components
lib/            25 modules, including lib/scanner/ (12)
supabase/       migrations 0001–0009
__tests__/      148 tests
docs/           this and 9 others
prototype/      the original single-file app — reference only, not built or served
public/app.html the older prototype build — reference only
```

`index.html` — the 2.7 MB single-file prototype that used to *be* the product —
**is no longer in the repository root.** The preserved copy is
`prototype/pokai-app-bundled.html`. Any instruction anywhere referring to
"`index.html` line 2148" is obsolete: that defect was in the prototype, and the
prototype is not the product.

**How this was verified:** `find` over the working tree, and `git log`.

---

## 2. Does it build, typecheck and test?

Yes. All three, on 2026-09-14:

| Check | Command | Result |
|---|---|---|
| Tests | `npm test` | **148 passed**, 8 files |
| Types | `npm run typecheck` | clean |
| Build | `npm run build` | compiled successfully |

**CI runs all of the above** on every push to `main` and every pull request
(`.github/workflows/ci.yml`), plus a check that no credential-shaped value has
been committed. It needs no secrets: the tests stub every network call and the
build does not require the API keys, both verified by running them with a
completely empty environment.

**What CI does not yet do is BLOCK a merge.** That needs branch protection
enabled on `main` in the GitHub repository settings, which requires an admin.
Until then a red check is a warning, not a gate.

**How this was verified:** all three commands were run.

---

## 3. What is deployed

Production: **https://pok-ai-drab.vercel.app**, on Vercel, deploying from `main`.

The founder has confirmed by using it that scanning, pricing, the collection and
the portfolio all work on a real phone against real cards. The live database
holds real scans, real collection rows and a real recorded portfolio valuation
(`$46.75`, 4 cards, 0 unpriced), which is corroborating evidence that the whole
chain runs.

**How this was verified:** live database query, plus the founder's reports. It
was *not* verified by fetching the site — see §8.

---

## 4. The live database

Supabase project **`yycsgtsvkhguzihyxtur`** (`us-east-2`, Postgres 17). Schema is
migrations `0001`–`0009`, all applied.

Tables: `cards`, `card_sets`, `card_prices` (+ `card_prices_latest` view),
`collections`, `scans`, `corrections`, `portfolio_snapshots`, `profiles`,
`scan_usage`, `sync_runs`.

State on 2026-09-14:

| | |
|---|---|
| Anonymous accounts | 90 |
| Real (email) accounts | 2 |
| Collection rows | 5, split across 2 accounts |
| Cards cached | **0** |
| Prices cached | **0** |
| Last activity | 2026-09-08 19:57 UTC |

Two of those numbers are defects and are explained in §6.

Row-level security is on for every table and was verified by test. **Re-run
those tests after any policy change** (`supabase/README.md`). An RLS mistake is
silent and the failure mode is one user reading another's collection.

**How this was verified:** SQL against the live database.

---

## 5. What works

- **Scanning.** 2160p capture, corner crops, best-of-six frames, blur and glare
  detected separately, auto-capture when the frame is sharp, torch control. A
  vision model (Claude Haiku 4.5) identifies the card; on-device OCR is the
  fallback.
- **Never-guess.** Enforced in `lib/scanner/resolve.ts` and defended by 75 tests.
  Weak signals rank, strong signals identify, ranking runs first.
- **Card data and prices** from tcgapi.dev, which sources pricing from TCGplayer.
- **Collections** — saving, quantity, condition, per-user isolation by RLS.
- **Portfolio** — total value, change since the last recorded day, rarity
  breakdown, collection score, achievements, top holdings, value history.
- **Accounts** — anonymous by default so nothing blocks a first scan; email and
  password can be added later and the collection carries over on the same
  account.
- **Anti-abuse** — scanning requires a session, a database-backed 300/day cap,
  and Turnstile support that activates as soon as a site key is set.
- **Diagnostics** — `/api/health` reports every variable's presence, whether its
  value came from the runtime or was baked in at build time, whether Supabase
  *accepts* the service-role key, and which commit is answering.

---

## 6. Known defects

### a) Collections fragment across anonymous accounts — **highest value**

Anonymous accounts are still occasionally created in pairs, and a user's cards
can end up on an account their browser can no longer reach. This happened to the
founder: four cards across three accounts, reunited by hand on 2026-09-08.

Two fixes are in (a page-scoped promise, then a cross-tab Web Locks request
around account creation) and it is **narrowed but not closed**. The diagnostic
now in place records which page load created each account, and it says the two
accounts in a pair come from *different* page loads — so the lock works, and the
problem is that the stored session is not surviving, or one navigation is
producing two documents.

Full detail, including the query, is in [`HANDOVER.md`](HANDOVER.md) §4a.

### b) The card catalogue has never cached a row

`cards: 0`, `card_prices: 0`. Supabase rejects the service-role key held in
Vercel — the signature of a key rotated in Supabase while Vercel kept the old
one. Prices still work, because the app falls back to asking tcgapi.dev
directly. It is a cost and latency problem, not a correctness one.

Needs a person with both dashboards open. Ninety seconds of work, blocked on
access rather than on code.

---

## 7. Not built

- **Tournaments.** Deliberately not ported: every player and result in the
  prototype's version is invented, and prize competitions carry real legal
  exposure. A founder decision.
- **Per-condition pricing.** Condition is recorded; it does not yet affect value.
- **A scheduled catalogue sync.** The cache fills opportunistically today.
- **Branch protection.** CI exists; making it enforcing is a GitHub setting. See §2.

---

## 8. What this document does not know

The environment these notes were written in cannot reach `api.tcgapi.dev`,
`supabase.co` over HTTPS, or the deployed site — all three are blocked by
network egress policy. Supabase was reachable only through a separate
administrative connection, which is how §4 was checked.

Therefore **not** verified here:

- Any direct call to tcgapi.dev. Its documented `/v1/cards/{id}` endpoint has
  never returned a verified response to us; the client tolerates two shapes and
  falls back to `/v1/search`, which *has* been verified, precisely for that
  reason.
- The deployed site's current behaviour, by fetching it.
- Sign-up, sign-in and password-reset round trips. Two real accounts exist in the
  live database, which is evidence the flow works, but no round trip was
  observed from here.

---

## Correction log

**2026-09-14.** This file was rewritten from scratch. The 2026-08-31 version was
accurate when written and had become wrong in every material respect:

| It said | Reality on 2026-09-14 |
|---|---|
| "The entire repository is two files" | ~60 source files, a Next.js app |
| No build step, package manager, or tests | All present; 148 tests |
| "Nothing is deployed with a working backend" | Live and working in production |
| "Nothing saves between page loads" | Collections persist in Postgres |
| "tcgapi.dev has never been successfully called" | It is pricing real cards |
| Open defect at `index.html` line 2148 | That file is no longer the product |

The lesson worth keeping: a status document that goes stale is worse than none,
because it is trusted. Anyone landing here in another six months should check
the verification date first and distrust everything if it is old.
