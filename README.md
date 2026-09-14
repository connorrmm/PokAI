# PokAI

Point a phone at a Pokémon card. Know exactly which card it is, what it's
worth, and keep it in a collection that follows you.

**SCAN → KNOW → TRACK → GROW**

Live: **https://pok-ai-drab.vercel.app**

---

## Status: working, in private testing

This is a deployed application, not a prototype. Scanning, pricing, collections
and the portfolio all work end to end against real data.

It has **two known defects** and a short list of things not built yet. Both are
written down in [`docs/STATUS.md`](docs/STATUS.md), with the evidence. Read that
before you trust anything else here — including this file.

If you are the new developer, start with
[`docs/HANDOVER.md`](docs/HANDOVER.md). It gets you running locally in about ten
minutes and tells you what to be careful of.

---

## What it does today

| | |
|---|---|
| **Scan** | Camera capture at 2160p, auto-shutter when the frame is sharp, then a vision model identifies the card |
| **Never guesses** | Below the confidence bar it shows every matching print and asks. This is enforced by code and by tests, not by convention |
| **Prices** | Live market prices from tcgapi.dev, sourced from TCGplayer |
| **Collection** | Cards save to your own account. Row-level security means nobody can read anyone else's |
| **Portfolio** | Total value, rarity breakdown, collection score, achievements, and value history recorded on each visit |
| **Accounts** | Scanning needs no sign-up. Email and password can be added later, and the collection comes with it |

## The four rules

These are product decisions, not implementation preferences. They came from real
users. Do not trade them away for convenience.

1. **Never guess a card.** Below the auto-accept threshold, show every matching
   print and let the user choose. A confident wrong answer destroys trust far
   worse than a question does.
2. **Never fabricate a price.** If live data is unavailable, say so. No
   estimates, no interpolation, no stale number dressed up as current.
3. **Never invent card data.** Names, sets, numbers and rarities come from a real
   card database. If a lookup fails, surface the failure.
4. **Show the real error.** Never "something went wrong." This project has lost
   days — repeatedly — to errors that hid their own cause.

`__tests__/never-guess.test.ts` exists to keep rule 1 honest. It has 75 cases.

## Stack

- **Next.js 15** (App Router) + React 19 + TypeScript, on **Vercel**
- **Supabase** — Postgres 17, auth, row-level security
- **tcgapi.dev** — card catalogue and prices (which sources pricing from TCGplayer)
- **Claude Haiku 4.5** — vision, for recognising the card
- **Vitest** — 148 tests

## Layout

```
app/                    pages and API routes
  api/identify          scan → card
  api/search            card lookup
  api/collection        a user's cards
  api/portfolio         value, history, score
  api/scans             scan history
  api/health            configuration and build diagnostics
components/             the UI
lib/
  scanner/              recognition: cropping, OCR, ranking, confidence
  supabase/             two clients — as-the-user, and service-role
  tcgapi.ts             the card database client (server only)
  portfolio.ts          valuing a collection
supabase/migrations/    the live database schema, 0001–0009
__tests__/              148 tests
docs/                   see below
prototype/              the original single-file app, kept for reference only
```

## Docs

| File | Read it when |
|---|---|
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | **You are new. Start here.** |
| [`docs/STATUS.md`](docs/STATUS.md) | You want to know what is real and what is broken |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | You are making a product decision |
| [`docs/SCANNER.md`](docs/SCANNER.md) | You are touching recognition — **expensive findings live here** |
| [`docs/CATALOG.md`](docs/CATALOG.md) | You are touching card data, prices, or the licence |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | You want to know why the stack is the stack |
| [`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md) | Decisions the founders still owe |

## Running it

```bash
npm install
cp .env.example .env.local     # then fill it in — see docs/HANDOVER.md
npm run dev
```

```bash
npm test          # 148 tests
npm run typecheck
npm run build
```

CI runs those three plus a committed-credential check on every pull request.
It needs no secrets.

## A warning about keys

**This repository is public.** Every paid key lives in Vercel's environment
variables and is read server-side only. The browser never calls a third-party
API directly — it calls our API, and our API holds the keys.

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security completely. It is used
for exactly one thing: reading the card catalogue, which is server-only for
licence reasons. It must never reach client code, a commit, or a chat window.
