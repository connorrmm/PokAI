# PokAI

Pokémon card scanning and collection platform. Point a phone at a card, know
exactly which card it is, what it's worth, and track it in a collection.

Founder: Sterling Sanchez Garcia. Co-founder: Connor Miller.
Sterling is non-technical. Explain tradeoffs in plain language, and do not
assume a technical decision is obvious to him just because it's obvious to you.

## You own the technical decisions

Stack, architecture, framework, hosting, database, and file layout are **yours
to choose**. There is a prototype in this repo, but it is a prototype: a single
HTML file built fast to prove the idea. Do not treat its structure as a
constraint or a pattern to follow. If rebuilding is the right call, say so and
explain why in plain language before doing it.

What is NOT yours to change is the product behavior in `docs/PRODUCT.md`.
Those rules came from real user thinking, not from implementation convenience.

Read `docs/STATUS.md` first — it says what actually exists versus what people
have merely talked about, and it was verified against the real repository on
2026-08-31. Two findings there change how you should read everything else:
the backend described in earlier notes **is not in this repository and never
has been**, and the committed `index.html` is an **older build** than the
prototype preserved at `prototype/pokai-app-bundled.html`.

## Decisions already made — do not relitigate without reason

Settled 2026-08-31; reasoning in `docs/ARCHITECTURE.md`.

- **Stack:** Vercel (front end + serverless API), Supabase (Postgres, auth,
  storage), tcgapi.dev (card data + prices), Claude Haiku 4.5 (vision).
  Switched from Netlify to Vercel on 2026-08-31 at Sterling's direction.
  Vercel's free Hobby plan is non-commercial only — Pro ($20/mo) before launch.
- **Web app, not native.**
- **Extend the prototype, don't rebuild it.** The OCR pipeline carries real
  hard-won fixes; the missing pieces go behind it.
- **Recognition moves to a server-side vision model.** There is no AI vision
  model in the app today — it is Tesseract OCR.
- **The browser never calls a third-party API directly.** It calls our API; our
  API holds every paid key. This is what keeps keys out of a public repo.
- **Card data is cached in our own database** and refreshed on a schedule. The
  scan path never depends on a third party being up.

## Non-negotiable product rules

1. **Never guess a card.** If confidence is below the auto-accept threshold, show
   every matching print and let the user pick. Never silently show one guess as
   though it were certain. A wrong confident answer destroys trust far worse
   than asking.
2. **Never fabricate a price.** If live market data is unavailable, say the value
   is unavailable. Do not estimate, interpolate, or fall back to a stale number
   presented as current.
3. **Never invent card data.** Card names, set names, numbers, and rarities come
   from a real card database. If a lookup fails, surface the failure.
4. **Show the real error.** When a scan fails, display what actually went wrong,
   not a generic "something went wrong." Sterling has repeatedly been unable to
   debug because the app hid the real error text.

## Known open defect — do not ship over it

The committed `index.html` violates rule 1 above. On a low-confidence read it
returns no candidate list (line 2148), so the user hits the dead end
`docs/PRODUCT.md` forbids; on an ambiguous read it truncates candidates to 8
(line 2150). `prototype/pokai-app-bundled.html` already does both correctly.
Fix this before building anything on top of the scanner.

## Working agreements

- **Verify before claiming.** Do not report something as working because the code
  looks correct. Run it. If you cannot run it, say plainly that you could not.
  This project has already lost time to confident claims that turned out wrong.
- **Say when you don't know.** Especially about live API behavior, hosting state,
  and whether something is deployed. Guessing here has burned real hours.
- **No secrets in client code.** Any paid API key belongs server-side. Keys live
  in Vercel environment variables. This repo is public — anything committed to
  it is published to the world.
- Ask before adding a paid dependency or a service that costs money.

## Reference docs

Read these when the task touches them; they are not needed every session.

- `docs/STATUS.md` — what exists, what doesn't, what's deployed (read first)
- `docs/PRODUCT.md` — vision, MVP scope, the values behind the rules above
- `docs/SCANNER.md` — recognition pipeline: real failure modes and tuned values
- `docs/CATALOG.md` — card database strategy and a verified naming bug
- `docs/OPEN-QUESTIONS.md` — decisions Sterling still needs to make
- `docs/ARCHITECTURE.md` — the stack, and why each piece was chosen
- `docs/ROADMAP.md` — build order to production, phase by phase
- `docs/SETUP-CHECKLIST.md` — accounts and keys Sterling must create
- `docs/MODEL-POLICY.md` — which model to use for which work, to protect usage limits

`docs/SCANNER.md` and `docs/CATALOG.md` contain findings from real testing
against the live API and real devices. Some are non-obvious and cost hours to
discover. Read the relevant one before touching recognition or card data.

## Model routing — keep the usage budget alive

Full detail in `docs/MODEL-POLICY.md`. The short version: **Opus thinks, Sonnet
fetches.** Three Sonnet-pinned helper agents are defined in `.claude/agents/`:

- `scout` — searching, counting, tracing, reading large files
- `verifier` — running builds, tests, servers, and reporting the raw output
- `scribe` — mechanical doc edits once a decision is already made

Delegate to them by default. Never read `index.html` whole into the main
conversation — it is 2.7 MB and ~93% embedded base64 images. Filter first with
`awk 'length($0)<600' index.html`, which leaves the ~180 KB that is actual code.

Keep on Opus regardless of how mechanical it looks: recognition and confidence
logic, anything touching the "never guess" rule, security, and anything
involving secrets, auth, or money. Being quietly wrong about those is expensive
and hard to notice.

## Live infrastructure

- **Supabase project `yycsgtsvkhguzihyxtur`** (`us-east-2`, Postgres 17) is real
  and the schema is applied. Migrations live in `supabase/migrations/` — if you
  change the database, add a migration there too.
- Row-level security is on for every table and was verified by test. **Re-run
  those tests after any policy change** (`supabase/README.md`) — an RLS mistake
  is silent, and the failure mode is one user seeing another's collection.
- **Vercel is connected but has no project.** Nothing is deployed anywhere.
- **tcgapi.dev has never been successfully called.** A key exists, but the
  sandbox blocks the domain. Treat every documented detail about it as
  unverified until a real request succeeds.

## Repository facts worth not re-deriving

- The repo is **public**. No paid API key may ever appear in client code.
- The whole repo is `index.html` + `README.md` + docs. There is no build step,
  no package manager, no test suite, and no CI.
- `index.html` hardcodes `http://localhost:3001` as its backend (line 1688).
  A deployed HTTPS page cannot call that at all — browsers block it as mixed
  content. This must be fixed before any deploy is meaningful.
