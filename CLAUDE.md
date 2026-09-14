# PokAI

Pokémon card scanning and collection platform. Point a phone at a card, know
exactly which card it is, what it's worth, and track it in a collection.

Founder: Sterling Sanchez Garcia. Co-founder: Connor Miller.
Sterling is non-technical. Explain tradeoffs in plain language, and do not
assume a technical decision is obvious to him just because it's obvious to you.

**Read `docs/STATUS.md` first** — it says what actually exists, verified against
the running code and the live database on 2026-09-14. If that date is old by the
time you read it, re-verify before trusting it. A stale status document is worse
than none, because it gets believed.

New developer? `docs/HANDOVER.md` is written for you.

## You own the technical decisions

Stack, architecture, framework, hosting, and file layout are **yours to choose**.
What is NOT yours to change is the product behaviour in `docs/PRODUCT.md`. Those
rules came from real user thinking, not from implementation convenience.

## Non-negotiable product rules

1. **Never guess a card.** If confidence is below the auto-accept threshold, show
   every matching print and let the user pick. Never silently show one guess as
   though it were certain. A wrong confident answer destroys trust far worse
   than asking.
2. **Never fabricate a price.** If live market data is unavailable, say the value
   is unavailable. Do not estimate, interpolate, or fall back to a stale number
   presented as current.
3. **Never invent card data.** Card names, set names, numbers and rarities come
   from a real card database. If a lookup fails, surface the failure.
4. **Show the real error.** Display what actually went wrong, not a generic
   "something went wrong." This project has lost days, more than once, to an app
   that hid its own failure.

Rule 1 has been violated in production once. Ranking by foil pattern ran *after*
the step that decided a card was identified, and the app showed one card at 100%
confidence and the wrong price — $0.76 against a real $7.43. Every test passed.
`lib/scanner/resolve.ts` now enforces the ordering structurally: **weak signals
rank, strong signals identify, ranking runs first.** Preserve that property.

## Decisions already made — do not relitigate without reason

- **Stack:** Next.js 15 (App Router) + React 19 + TypeScript on Vercel; Supabase
  (Postgres 17, auth, RLS); tcgapi.dev for card data and prices; Claude Haiku 4.5
  for vision. Vitest for tests.
- **Web app, not native.**
- **The browser never calls a third-party API directly.** It calls our API; our
  API holds every paid key. This is what keeps keys out of a public repo.
- **Card data is cached in our own database.** The cache is an optimisation, not
  a precondition: when it cannot price a card the app asks the provider directly.
  Making the cache a requirement is what once produced a $0.00 portfolio.
- **Anonymous accounts by default.** Nothing blocks a first scan. Email and
  password are an upgrade on the same account, never a gate in front of the app.
- **Vercel's free Hobby plan is non-commercial only** — Pro ($20/mo) before this
  operates as a business.

## Current defects — do not ship over them

Documented with evidence in `docs/STATUS.md` §6 and `docs/HANDOVER.md`.

1. **The card catalogue has never cached a row** — the service-role key in Vercel
   is rejected by Supabase. Costs money and latency, not correctness.

**Fixed 2026-09-14: collections fragmenting across anonymous accounts.** Worth
knowing because the shape recurs. An account was created eagerly on page load,
so five components mounting created five accounts and a user's cards were
stranded on four of them. Two locking fixes narrowed it and neither closed it —
the accounts in a pair came from two DOCUMENTS, and no lock inside one page can
see another. The race was removed instead of won: **nothing creates an account
on load; only a deliberate press does** (`components/Auth.tsx`, `loadSession` vs
`ensureAccount`). Keep that split. A component mounting must never bring an
account into existence.

## Working agreements

- **Verify before claiming.** Do not report something as working because the code
  looks correct. Run it. If you cannot run it, say plainly that you could not.
  This project has already lost real time to confident claims that were wrong.
- **Say when you don't know.** Especially about live API behaviour, hosting
  state, and whether something is deployed.
- **No secrets in client code.** This repo is public — anything committed to it
  is published to the world. Keys live in Vercel environment variables, and they
  travel from the provider's dashboard to Vercel directly: never through a
  commit, an email, or a chat window, including this one.
- **`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security entirely.** It is for
  catalogue reads only. Never use it to read user data — `asUser()` exists for
  that, and mixing them is how one person sees another's collection.
- **Changed the database? Add a migration** in `supabase/migrations/`.
- **Changed an RLS policy? Re-run the RLS tests** (`supabase/README.md`). An RLS
  mistake is silent.
- Ask before adding a paid dependency or a service that costs money.

## Reference docs

- `docs/HANDOVER.md` — for a developer joining: how to run it, what to watch for
- `docs/STATUS.md` — what exists, what's broken, what's unverified (read first)
- `docs/PRODUCT.md` — vision, MVP scope, the values behind the rules above
- `docs/SCANNER.md` — recognition: real failure modes and tuned values
- `docs/CATALOG.md` — card data strategy, the licence, a verified URL bug
- `docs/OPEN-QUESTIONS.md` — decisions Sterling still needs to make
- `docs/ARCHITECTURE.md` — the stack, and why each piece was chosen
- `docs/ROADMAP.md` — build order to production
- `docs/MODEL-POLICY.md` — which model for which work, to protect usage limits

`docs/SCANNER.md` and `docs/CATALOG.md` contain findings from real testing
against the live API and real devices. Some are non-obvious and cost hours.
Read the relevant one before touching recognition or card data.

## Model routing — keep the usage budget alive

Full detail in `docs/MODEL-POLICY.md`. The short version: **Opus thinks, Sonnet
fetches.** Three Sonnet-pinned helper agents are defined in `.claude/agents/`:

- `scout` — searching, counting, tracing, reading large files
- `verifier` — running builds, tests, servers, and reporting the raw output
- `scribe` — mechanical doc edits once a decision is already made

Delegate to them by default. `prototype/pokai-app-bundled.html` and
`public/app.html` are multi-megabyte and mostly base64 images — never read either
whole into the conversation; filter with `awk 'length($0)<600'` first.

Keep on Opus regardless of how mechanical it looks: recognition and confidence
logic, anything touching the "never guess" rule, security, and anything
involving secrets, auth, or money. Being quietly wrong about those is expensive
and hard to notice.

## Live infrastructure

- **Production:** https://pok-ai-drab.vercel.app, deploying from `main`.
- **Supabase project `yycsgtsvkhguzihyxtur`** (`us-east-2`, Postgres 17), schema
  = migrations 0001–0009, all applied. RLS on for every table.
- **tcgapi.dev works in production** — it is pricing real cards. It has never
  been reachable from the development sandbox, so treat anything about its
  behaviour that is not marked verified as secondhand.
- **`/api/health`** reports configuration, where each value came from (runtime vs
  baked in at build), whether Supabase accepts the service-role key, and which
  commit is answering.
