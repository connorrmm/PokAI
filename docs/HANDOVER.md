# Handover — start here

Written 2026-09-14 for the developer joining PokAI.

Everything in this file was checked against the running code and the live
database on that date. Where something could not be checked, it says so and says
why. That distinction matters more than usual here: this project has repeatedly
lost days to confident claims that turned out to be wrong, and the previous
generation of these documents described a repository that no longer existed.

---

## 1. Running it, in about ten minutes

```bash
git clone https://github.com/connorrmm/PokAI
cd PokAI
npm install
cp .env.example .env.local
```

Now fill in `.env.local`. `.env.example` explains every variable. The short
version:

- **`TCGAPI_KEY`** and **`ANTHROPIC_API_KEY`** — ask Sterling. Nothing scans
  without them.
- **`NEXT_PUBLIC_SUPABASE_URL`** — already filled in.
- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** — Supabase → Project Settings → API Keys.
  Public by design; safe in your `.env.local` and in the browser.
- **`SUPABASE_SERVICE_ROLE_KEY`** — **leave it blank to start.** The app works
  without it. See §5 before you decide you need it.

```bash
npm run dev        # http://localhost:3000
npm test           # 148 tests, ~2s
npm run typecheck
npm run build
```

Those last three are exactly what CI runs on every pull request, in that order,
with an empty environment. If they pass locally they will pass there.

If `npm run dev` starts but the app says sign-in is unavailable, your two
`NEXT_PUBLIC_` variables are missing — and note that those are compiled into the
bundle, so you must restart `dev` after changing them.

**`/api/health` is the fastest way to find out what a deployment can actually
see.** It reports every variable's presence, whether it came from the runtime or
was baked in at build time, whether Supabase actually *accepts* the service-role
key, and which commit is answering. It was built during a bug that cost a full
day precisely because nothing could answer those questions.

---

## 2. The four rules, and why they are not negotiable

Read [`PRODUCT.md`](PRODUCT.md) properly. In brief:

1. **Never guess a card.** Below the confidence threshold, show every matching
   print and ask. `__tests__/never-guess.test.ts` has 75 cases defending this.
2. **Never fabricate a price.** Unavailable is an answer. An estimate is not.
3. **Never invent card data.** It comes from the catalogue or it does not exist.
4. **Show the real error.** Never a generic failure.

Rule 1 has been broken in production once, and it is worth knowing how, because
the shape recurs. The ranking step used foil patterns to order candidates, and
it ran *after* the step that decided the card was identified. The app showed one
card, at 100% confidence, at the wrong price — $0.76 against a real $7.43. Every
test passed. The fix is in `lib/scanner/resolve.ts`, and its structure now
enforces the order: **weak signals rank, strong signals identify, ranking runs
first.** Keep that property if you touch it.

---

## 3. Where things are, and which parts are load-bearing

```
lib/scanner/       recognition. Read docs/SCANNER.md BEFORE editing anything here
lib/tcgapi.ts      the card database client. Server-only; holds the paid key
lib/portfolio.ts   valuing a collection. Shared by two routes deliberately —
                   two endpoints computing a total slightly differently is how a
                   portfolio quietly stops matching the list it is the sum of
lib/supabase/      two clients, kept apart on purpose:
                     asUser()  — acts as the signed-in person, RLS applies
                     admin()   — bypasses RLS, catalogue reads ONLY
components/Auth.tsx      sessions. Small, subtle, has caused real damage — §4
components/Account.tsx   the sign-in / sign-up form
supabase/migrations/     0001–0009, all applied to the live database
```

**If you change the database, add a migration.** The live schema is the sum of
that folder.

**If you change a row-level-security policy, re-run the RLS tests**
(`supabase/README.md`). An RLS mistake is silent, and the failure mode is one
user reading another user's collection.

### Two hard-won findings you should not rediscover

Both are in [`SCANNER.md`](SCANNER.md) and [`CATALOG.md`](CATALOG.md) in full.

- **Camera resolution decides accuracy.** At 1080p a collector number is about
  21 pixels tall and the model cannot read it. At 2160p it is ~42px and it can.
  This was found because every scan reported an identical token count.
- **The API base URL is `https://api.tcgapi.dev/v1`** — the `api.` subdomain.
  `tcgapi.dev/v1/...` returns 404 on every path, and 404 rather than 401, so it
  looks like a broken key rather than a wrong host.

---

## 4. Known defects — inherited, not hidden

### a) Collections fragment across accounts *(the important one)*

The app signs everyone in anonymously so nothing blocks a first scan. That
account is real and private, but it lives in one browser's storage.

On 2026-09-08 three anonymous accounts were created within thirty minutes and
the founder's four cards were split across them, invisible to him. Five
components each called `useSession()`, each found no session, and each created
its own account; the last one to finish won the browser's storage and the rest
became accounts nobody could sign back into. Two fixes went in: a page-scoped
promise, then a cross-tab Web Locks request around account creation.

**It is not fully fixed.** Accounts are still occasionally created in pairs.
There is a diagnostic already in place: every anonymous account records the id
of the page load that created it, in its own Supabase metadata. Querying that on
2026-09-14 gave the answer:

```
17:04:46.248509  page ec88fd00
17:04:46.248513  page f0444166   ← 4 microseconds later, DIFFERENT page id
```

Different page ids means **two separate page loads**, each signing in once — not
one page signing in twice. So the lock is doing its job; what is failing is that
the stored session is not surviving, or two documents are being created for one
navigation (a speculative prerender would do exactly this). That is where to
pick it up. The query:

```sql
select raw_user_meta_data->>'created_by_page' as page_id, count(*), min(created_at)
from auth.users where is_anonymous group by 1 order by 3 desc;
```

Live state today: 90 anonymous accounts, 2 real ones, 5 collection rows split
across 2 accounts.

**This is the highest-value bug in the product.** A collector whose cards vanish
does not come back.

### b) The card catalogue has never cached a single row

`cards: 0`, `card_prices: 0`. Supabase rejects the `SUPABASE_SERVICE_ROLE_KEY`
held in Vercel with "Invalid API key" — the signature of a key that was rotated
in Supabase while Vercel kept the old one.

Prices still work: when the cache cannot answer, the app asks tcgapi.dev
directly and uses the live price. So this is a cost and latency problem, not a
correctness one. `/api/health` reports it under `service_role`.

Fixing it needs someone with both dashboards open: copy the current
service-role key from Supabase into the existing Vercel variable, redeploy.

---

## 5. Security, in one page

- **The repository is public.** Assume anything committed is published.
- **Every paid key is server-side.** The browser calls our API; our API holds the
  keys. Keep it that way — this is the rule that keeps a public repo safe.
- **`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security completely.** Whoever
  holds it can read and rewrite every user's collection. It exists for one job:
  reading the card catalogue, which migration 0004 made server-only because
  tcgapi.dev's licence permits caching but forbids redistribution. Never use it
  to read user data — that is what `asUser()` is for, and mixing them is how one
  person ends up seeing another's cards.
- **Secrets go from the provider's dashboard into Vercel directly.** Not through
  email, not through chat, not through an assistant. Every extra copy is another
  place it can leak.
- **Row-level security is on for every table** and was verified by test. It is
  the thing standing between users' collections.

---

## 6. Not built yet

- **Tournaments.** The prototype has a tournaments screen. Every player, match
  and winner in it is invented, and there is no prize fulfilment behind it. It
  was deliberately not ported. Running prize competitions also carries real
  legal exposure depending on jurisdiction — a founder decision, not a coding
  task.
- **Per-condition pricing.** Condition is recorded on each card but does not yet
  affect its value.
- **A scheduled catalogue sync.** The cache fills opportunistically as cards are
  searched. tcgapi.dev refreshes prices daily, so a nightly job would match their
  cadence — see `CATALOG.md`.
- **Branch protection.** CI now runs on every pull request
  (`.github/workflows/ci.yml`: no committed credentials, typecheck, tests,
  build) — but GitHub will not *block* a merge on a failing check until someone
  with admin rights turns on branch protection for `main`. Until then CI is
  advice, not a gate.

---

## 7. What has never been verified, and why

The development sandbox these were built in cannot reach `api.tcgapi.dev`,
`supabase.co`, or the deployed site — outbound requests to all three are blocked
by network policy. Everything below is therefore believed-but-unproven from
inside the repository, and was confirmed only by the founder using the live app
on his phone:

- Any real call to tcgapi.dev. The client handles two response shapes for
  `/v1/cards/{id}` and falls back to `/v1/search` *because* that endpoint has
  never returned a verified response to us.
- Sign-up, sign-in and password reset round trips. Two real accounts now exist
  in the live database, which is the evidence that the flow works.
- Anything about what is currently deployed.

If a document tells you something about live API behaviour, check whether it
says it was verified. Several were not, and `CATALOG.md` is explicit about
which.
