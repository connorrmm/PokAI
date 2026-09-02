# Current status — what actually exists

Last verified: **2026-08-31**, against commit `1641dfe` on `main`.
Updated the same day with the backend question resolved and the production plan
decided — see `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and
`docs/SETUP-CHECKLIST.md`.

Every claim in this file was checked against the repository or observed by
running the app. Where something could not be checked, it says so and says why.
If you are about to trust a sentence here, the "How this was verified" line at
the end of each section tells you how far that trust should go.

The previous version of this file was written without access to the repository.
Most of it was right. The parts that were wrong were wrong in an expensive
direction, so there is a correction log at the bottom.

---

## 1. The repository

Public repo: `github.com/connorrmm/PokAI` — default branch `main`, created
2026-08-04, last pushed 2026-08-29.

**The entire repository is two files:**

| File | Size | What it is |
|---|---|---|
| `index.html` | 2.74 MB / 3,421 lines | The whole prototype — markup, CSS, and ~2,650 lines of JavaScript |
| `README.md` | 7 bytes | The text `# PokAI` |

Of `index.html`'s 2.74 MB, about **2.56 MB (93%) is 14 embedded base64 images** —
12 card photos plus a favicon and a wordmark. The actual code is roughly 180 KB.

There are 11 commits. All of them were made by `connorrmm` through the GitHub
website, not from a development machine — every message is `Add files via
upload`, `Delete index.html`, or `Initial commit`. Only three filenames have
ever existed in the history: `README.md`, `index.html`, and
`pokai-prototype github.html`.

**Nothing else has ever been committed.** No `package.json`, no server code, no
database schema, no build config, no tests, no CI, no deploy config.

*How this was verified:* `git log --all`, `git rev-list --objects --all` to list
every file ever committed including deleted ones, and the GitHub API for repo
metadata. This is solid.

---

## 2. Where the old status file was wrong

### It said the backend "has never run." The truth is worse: it isn't here.

The previous file described "an Express app with routes for search, identify,
scan history and corrections, plus a Supabase schema and catalog-building
scripts," and said the decision to keep, adapt, or discard it was open.

That decision is not open, because **none of that code is in this repository and
none of it ever has been.** I checked every file in every commit, including
deleted ones. There is no backend to keep, adapt, or discard.

`index.html` line 1688 refers to it as if it exists:

```js
const POKAI_BACKEND_BASE = window.POKAI_BACKEND_BASE || 'http://localhost:3001';
```

with a comment saying "see /pokai-backend". There is no `/pokai-backend`.

**RESOLVED 2026-08-31.** Sterling confirmed: all prior work was done in Claude
chat sessions and pasted in by hand. Claude Code was never used, and no backend
was ever saved as real files. So there is nothing to recover — the backend gets
built fresh. See `docs/ARCHITECTURE.md`.

This is better news than it sounds. There is no half-finished server to inherit,
debug, or trust. The first backend can be built small, deliberately, and to fit
the plan rather than to fit whatever a chat session produced months ago.

### It said Sterling's prototype is `pokai-app.html`. The committed app is a different, older build.

The handoff bundle contained a file called `pokai-app.html` (3,479 lines). The
repository contains `index.html` (3,421 lines). They are **not the same file**,
and the bundled one is **ahead**, not behind.

The bundled version contains three pieces of work that **have never existed in
any commit in this repository**:

| Feature | Bundled `pokai-app.html` | Committed `index.html` |
|---|---|---|
| Retry with backoff on card lookups | `fetchCardSearch()` — 3 attempts, 350ms backoff, 12s timeout | **Absent.** One `fetch`, no retry |
| Full candidate list on a low-confidence read | Returns every name match | **Returns nothing to pick from** |
| Candidate list when ambiguous | Every name match, untruncated | Truncated to the top 8 |
| Placeholder art when a card image fails | `generatePlaceholderArt()` draws an SVG | **Absent.** Card renders with no art |

I have preserved the bundled file at `prototype/pokai-app-bundled.html` so it
cannot be lost again.

### The committed app violates the project's own number-one product rule.

This is the most important finding in this document.

`CLAUDE.md` rule 1 is "Never guess a card — if confidence is below the threshold,
show every matching print and let the user pick." `docs/PRODUCT.md` adds that the
list is never truncated, and that "a dead-end error is unacceptable."

In the committed `index.html`, when the scanner is **not confident**, line 2148
returns a result with no candidate list at all:

```js
return {ok:false, reason:'low_confidence', text, confidence, topGuess: top.apiCard};
```

Line 2317 only renders a picker `if(result.candidates && result.candidates.length > 0)`.
So the user gets the dead end the product doc explicitly forbids. When the read
is merely *ambiguous*, line 2150 caps the list at 8 (`ranked.slice(0, 8)`),
which is the truncation the product doc also forbids.

The bundled version gets both of these right. The fix already exists — it just
isn't in git.

*How this was verified:* read both files side by side at the cited line numbers,
and confirmed with `git show <commit>:index.html` across all 11 commits that
`fetchCardSearch` and `generatePlaceholderArt` have never appeared in this repo.
This is solid.

---

## 3. What the old file got right

- **Nothing persists.** Confirmed twice: there is not one reference to
  `localStorage`, `sessionStorage`, `indexedDB`, or cookies anywhere in the file,
  and after loading the running app I read `localStorage` directly and it was
  empty. Reload and everything is gone. No accounts, no saved collection.
- **The demo pool is 22 hardcoded cards.** Confirmed at runtime:
  `CARD_POOL.length` evaluated to `22` in the live page.
- **No authentication of any kind.** No login, signup, or password anywhere. The
  single user is the hardcoded string `'@you'`.
- **No tests, no CI, no rate limiting, no payments, no image storage.**
- **Scanner accuracy has never been measured.** Still true, and still the most
  consequential gap on the project.

---

## 4. What I ran, and what happened

I served `index.html` over a local HTTP server and loaded it in a real headless
Chromium browser. This is observed behaviour, not code reading.

**Worked:**
- The page loads and renders with **zero uncaught JavaScript errors**.
- All three tabs are present and wired: `scan`, `portfolio`, `tourney`.
- 12 of the 22 cards displayed art, from the embedded base64 photos.
- Failures were handled gracefully — the app caught every network error and fell
  back to its local pool instead of hanging or crashing.

**Failed, and why it matters:**
- Every card lookup hit `http://localhost:3001/api/search` and returned
  `ERR_CONNECTION_REFUSED`. The other 10 cards rendered with **no art at all**,
  because the placeholder generator isn't in this build.
- Tesseract.js did not load. `typeof window.Tesseract` was `undefined`.

**What I could NOT verify, and will not claim either way:**
- **The scanner has not been proven to work by me.** Tesseract loads from a CDN
  that is blocked in my sandbox, and there is no camera on this machine. The OCR
  code is real and substantial — genuine crop math, an inverted-polarity retry,
  hard timeouts on every async step, and real error text surfaced to the user —
  but I have not seen it read a card. Do not let anyone tell you I confirmed the
  scanner works. I confirmed the code exists and the page loads.
- **Whether anything is deployed.** Now answered — see section 5.

---

## 5. Deployment — partly unresolved

**Verified:** GitHub Pages is **off** (`has_pages: false` from the GitHub API).
No `netlify.toml`, `vercel.json`, `_redirects`, or GitHub Actions workflow has
ever been committed.

**ANSWERED 2026-08-31: nothing is deployed anywhere.** Sterling switched from
Netlify to **Vercel** and connected it. I checked the Vercel account directly —
team `longsterling61-4597's projects`, Hobby plan — and it contains **zero
projects**. Combined with GitHub Pages being off, no PokAI site is live on the
internet today.

Vercel is now the deploy target for both the front end and the API. Its Hobby
plan is licensed for non-commercial use only, so Pro at $20/month is required
before launch. See `docs/ARCHITECTURE.md`.

**This remains a real blocker before any deploy:** the committed app calls
`http://localhost:3001`. On a deployed site that fails twice over — the visitor's
own machine has nothing on port 3001, and a page served over HTTPS is not allowed
to call `http://` at all (browsers block it as mixed content). So **if the site
were deployed as-is today, its card lookups would be broken**, and it would run
on the 22-card offline fallback.

Also relevant: **camera access requires HTTPS.** Vercel provides that, so
scanning can work there in a way it cannot from a local file.

---

## 6. Secrets — clean

**No API keys, tokens, or credentials are committed.** Nothing needs to be
rotated. This is genuinely good news.

Checked: every blob in the full git history (not just the current files, so
deleted content is covered) against high-confidence patterns for OpenAI, Stripe,
AWS, GitHub, Google, Slack, SendGrid keys, JWTs and private keys; then a broader
keyword sweep for `api_key`, `secret`, `password`, `token`, `bearer`,
`authorization`, Supabase and Firebase references; then a specific check for keys
embedded in URLs or request headers, which is the realistic way a client-side app
leaks one.

The only hits for the word "secret" are the Pokémon card rarity tier
"Secret Rare."

The only external URLs in the code are the Tesseract.js CDN, Google Fonts, and
`http://localhost:3001`.

**Worth knowing anyway: this repository is public.** Anyone can read it. That is
fine today because there is nothing sensitive in it, but it becomes a live risk
the moment a backend exists. The rule in `CLAUDE.md` — no paid API key ever in
client code — is the thing that keeps it fine.

---

## 6b. There is no AI vision model in the scanner

Verified 2026-08-31. The scanner uses **Tesseract.js** (`index.html` line 1493,
loaded from a CDN at line 672) — a traditional optical character recognition
engine that matches letter shapes. It is not an AI model and does not understand
what it is looking at.

There is **no** vision model, no image-recognition service, and no AI provider of
any kind referenced anywhere in the application code. I grepped for every major
provider and found nothing.

This is the root cause of the recognition weakness described in
`docs/SCANNER.md`. Tesseract reads a cropped strip of pixels and returns its best
guess at the text; foil glare, stylised fonts and holo backgrounds defeat it, and
those are exactly the high-value cards that matter most.

The fix is planned in `docs/ARCHITECTURE.md` — a real vision model reading the
card server-side, replacing the OCR step while leaving the matching, confidence
and never-guess logic intact.

## 7. Honest summary of what is built

**Real and working:** a single-file browser prototype with a genuine OCR pipeline
(multi-crop, inverted-polarity retry, full-frame fallback, hard timeouts, real
error messages shown to the user), real canvas thumbnail generation, real
exact-duplicate photo detection by hash, a working confidence formula whose
ceiling is reachable, a manual-correction picker, and three tabs of polished UI.

**Simulated, by the prototype's own admission** (its architecture note at lines
780–830 says so explicitly): the demo "add card" flow's identification is a
seeded random pick; photo quality scores are randomised within realistic bands
rather than measured; valuation confidence and recent-sales figures are
placeholders; leaderboards and tournaments are hardcoded fictional users.

The OCR path and the demo path are different code. The OCR path is real.

**Does not exist at all:** any backend, any database, any persistence, any
accounts, any deployment config, any tests, any accuracy measurement, and **any
AI vision model** (see section 6b).

---

## Correction log

Fixed in this rewrite, with the old claim first:

1. "A schema was written; it has never been applied" → **no schema exists in this
   repo, and none ever has.**
2. "Backend source code that has never run... whether to keep, adapt or discard
   it is your call" → **the code is not here; there is nothing to decide about
   until it is found.**
3. "`pokai-app.html`, ~3,500 lines" described as the prototype → **the committed
   file is `index.html`, a different and older build; the bundled one is ahead on
   three fixes.**
4. Silent on the "never guess" regression → **now documented as the top code
   defect.**
5. Silent on `localhost:3001` → **now documented as the deploy blocker.**
6. "Nothing is deployed anywhere" stated flatly → **GitHub Pages confirmed off;
   deployment target moved to Vercel and confirmed to have zero projects.**

Confirmed correct and kept: nothing persists; 22 hardcoded cards; no auth; no
tests; scanner accuracy never measured; Tesseract fails under strict CSP; camera
needs HTTPS.

---

## 8. Live infrastructure — built and verified 2026-08-31

This section is new because, for the first time, PokAI has infrastructure that
actually exists.

**Supabase — built, secured, tested.** Project `yycsgtsvkhguzihyxtur`,
`us-east-2`, Postgres 17, healthy. Eight tables: `card_sets`, `cards`,
`card_prices`, `sync_runs`, `profiles`, `collections`, `scans`, `corrections`.
Schema is version controlled in `supabase/migrations/`.

Row-level security is on for every table, and was **verified by experiment
rather than assumed.** With two users' data really in the database:

| Test | Result |
|---|---|
| Logged-out visitor reads the catalog | allowed — intended, it's public data |
| Logged-out visitor reads collections and scans | **0 rows** |
| User A reads collections while user B has data | **only A's own row** |
| User A writes a row owned by user B | **blocked** |

Supabase's own security linter reported one ERROR and two warnings on my first
attempt — a view that would have bypassed user permissions, and a signup
function callable over the public API. Both are fixed and the linter is clean of
issues originating from this schema. Details in `supabase/README.md`.

The database is currently **empty of real data** — all test rows were deleted.

**Vercel — DEPLOYED 2026-08-31.** Live at `pok-ai-drab.vercel.app`, built from
`main` of `connorrmm/PokAI`, created through the dashboard after the API route
failed.

**Build configuration hazard, fixed the same day.** The project was created with
Framework Preset "Other" and a blank build command, which was correct while the
repo was a single HTML file. Once the Next.js rebuild merged that setting became
actively harmful: Vercel would serve files without building, so the API routes
would not exist, and because `index.html` moved to `public/app.html` the site
would 404 at the root. `vercel.json` now pins `"framework": "nextjs"`, which
takes precedence over the dashboard preset. Any project created from this repo
now builds correctly regardless of how its preset was set.

**Verification status, stated precisely:** I could not load the site. This
environment's egress proxy blocks `vercel.app`, so both `curl` and a fetch
returned nothing. What I did verify is that local `main`, remote `main` and the
commit Vercel built are all `3475d5f`, and that this commit contains every Phase
0 fix — candidates returned on a low-confidence read, no truncation to 8,
same-origin backend, retry logic, placeholder art. **So the deployed code is
correct; whether the deployed page renders is unconfirmed by me** and needs a
human to open it.

Card lookups will fail on the live site until the API exists. That is expected:
the app falls back to its 22-card offline pool with generated placeholder art.

Historic note on the tooling, so it is not repeated: creating the project through
the Vercel API reported success and returned a project id, but the project was
then invisible to every read — `get_project` 404'd and `list_projects` came back
empty, while a repeat attempt returned `409 already exists`. Two half-created
projects (`pokai`, `pokai-app`) may still exist and should be deleted. The
dashboard import worked first time.

Team `longsterling61-4597's projects`, Hobby plan.

The never-guess blocker is now fixed, so the app is deployable. What is blocking
is a tooling problem, recorded here so the next session does not repeat it:

Project creation through the Vercel API **reports success and returns a project
id, but the project is then invisible to every read.** `get_project` returns 404
for the returned id, and `list_projects` returns an empty array. Attempted twice
under two names (`pokai`, `pokai-app`); identical result both times. A third
attempt with the first name returned `409 conflict — project already exists`,
which contradicts the 404, so at least one half-created project probably exists
in a scope this tooling cannot enumerate.

**Do not keep retrying this through the API.** It creates orphaned projects. The
fix is to import the repo through the Vercel dashboard by hand, and to check for
and delete any stale `pokai` / `pokai-app` projects first.

Repository access was investigated as a cause and ruled out: `connorrmm` is the
sole collaborator on the repo, and Sterling confirmed he is working from that
account, so the GitHub side is fine.

**Not built:** the API itself, the sync job, and the vision endpoint. Those are
Phase 1 and 2 in `docs/ROADMAP.md`.

**Still unverified:** tcgapi.dev. This environment's network policy blocks the
domain, so despite now holding a key I have not been able to make a single real
call. Everything in `docs/CATALOG.md` about its endpoints and plans is from
public pages, not from the API. **Confirming it is the first task of Phase 1.**

## 9. The Next.js rebuild — in progress on a branch

Started 2026-08-31 on `claude/audit-repo-state-a8hhjy`. **Not merged, and must
not be merged yet.** See the hazard below.

**Done and verified:**
- Next.js 15 + TypeScript scaffolded. `npx next build` succeeds.
- The scanner's decision logic is ported into typed modules under
  `lib/scanner/` — `text.ts`, `confidence.ts`, `rank.ts`, `decide.ts`.
- **16 tests, all passing**, covering the never-guess rule for the first time
  in this project's history.
- `/api/search` proxies tcgapi.dev with the key server-side, with retry and
  backoff, rate limiting, and honest error text.
- `/api/health` reports which server config is present, never its values.

**Proof the tests are worth having.** They were checked by deliberately
reintroducing the two defects that actually shipped — dropping candidates on a
low-confidence read, and truncating the ambiguous list to 8. Three tests failed
immediately; restoring the correct code turned them green. A test that cannot
fail is decoration.

**Proof the API behaves.** Run locally: `/api/health` returned config presence;
`/api/search` with no query returned 400 with a real message; `/api/search?q=`
against the (sandbox-blocked) upstream returned the **actual** error —
`Host not in allowlist: api.tcgapi.dev` — rather than a generic failure, which
is product rule 4 working. Firing 35 requests produced 29 upstream errors then
429s, so the limiter trips exactly where configured.

### Routing — '/' is now the rebuild, '/classic' is the original

Changed 2026-08-31 after field testing. The rebuild kept the original app at
'/' while it was unproven, which was correct at the time and became wrong the
moment the vision scanner shipped.

The original can only ever run on-device OCR. Anyone opening '/' to scan a card
was therefore testing precisely the thing that had just been replaced — which
happened repeatedly during Sterling's testing and cost real time. Being told
which URL to use did not fix it, because the default was simply wrong.

- `/` — the rebuild, with vision recognition
- `/classic` — the original single-file app, kept for the portfolio and
  tournament screens that have not been ported
- `/preview` — redirects to `/`, so older links still land correctly

*Diagnostic worth remembering:* the two apps are distinguishable by their
failure text. Only the original says **"Couldn't confidently identify this
card"**. If that phrase appears, the classic app is being used.

### Merge safety — RESOLVED, this branch is safe to merge

There was a real hazard here and it is now fixed rather than merely documented.

The live site is served as a static `index.html`. Adding `package.json` makes
Vercel detect a Next.js project, so merging would have stopped serving that file
and shown the rebuild's placeholder page instead — an immediate, user-visible
regression.

The fix: the single-file app moved to `public/app.html`, and a `beforeFiles`
rewrite in `next.config.mjs` keeps `/` serving it. The rebuild lives at
`/preview` until it is genuinely better. `beforeFiles` runs ahead of the
filesystem, so it wins over any app-router page.

Verified by running the production build locally: `/` returned 2,740,981 bytes
titled "Pokai — Prototype", containing the never-guess fix and no truncation;
`/preview` and both API routes returned 200/400 as expected.

**When the ported UI is ready:** delete that rewrite and add `app/page.tsx`.
That single change is the cutover, and it is reversible.

Tracked in PR #1 (`https://github.com/connorrmm/PokAI/pull/1`).

**Also ported since:** the OCR pipeline itself — Tesseract worker with its
character whitelist and single-line page mode, multi-crop strategy with
inverted-polarity retry and full-frame fallback, canvas preprocessing, Otsu
thresholding, perceptual hashing — plus the full identification flow and a
working scan screen at `/preview`.

Verified in a real browser: the page renders with the scan control, and with no
camera present it surfaces the actual reason — *"Camera unavailable: Requested
device not found"* — rather than a generic failure.

**Known limitation found while testing:** Tesseract loads its engine and
language data from a third-party CDN at runtime. Versions are now pinned, and a
failure surfaces the real reason instead of an uncaught error, but scanning
still depends on that CDN being reachable. Self-hosting is the fix and is
costed in `docs/ROADMAP.md` Phase 4.

**Still to port:** portfolio, collection, scan history, tournaments, and the
reveal animation. The scan path itself is done.

## 10. THE SCANNER WORKS — first successful identification, 2026-09-02

A real Eevee ex, photographed normally on a phone, was identified outright:

> **Identified, 99% confidence — Eevee ex 075/131, SV: Prismatic Evolutions,
> Double Rare, $5.81**

The model's own description of the photo: *"soft/blurred and the foil texture
washes out the lower text."* It read the name, HP, ability, attack and
collector number anyway, and matched the exact print out of five sharing the
name.

This is the first time in this project's history that a card has been
identified from a real photograph.

### Measured cost — my estimate was wrong

**$0.0268 per scan** (2,607 input / 551 output tokens, claude-opus-5), 10.2s.

That is **$26.80 per 1,000 scans**, against the ~$12 I estimated in
`docs/ARCHITECTURE.md`. The estimate was out by more than double, and the
reason is instructive: output tokens cost 5x input on this model, and the
551 output tokens are far more than a short structured card record needs.
Adaptive thinking is on by default on Opus 5, and card reading is an extraction
task rather than a reasoning one.

Untested levers, in order of likely value: lower `effort`, a shorter `notes`
field, and a cheaper model. Same-photo comparisons are the way to choose -
see `docs/ROADMAP.md`.

### What made it work

Two changes, both driven by real scans rather than reasoning:

1. **Number and set together resolve a print.** Every print shares the card
   name, so name score can never break the tie, and three different cards carry
   075/131. Their intersection leaves exactly one.
2. **Only signals the model is SURE of may resolve it.** An earlier scan
   reported the number as *"tentative rather than confirmed"* and the set as
   *"inferred from the artwork rather than a clearly legible set symbol"*.
   Treating those as facts would have auto-accepted one of three cards priced
   $5.81, $8.86 and $26.76. The model now reports per-field certainty and only
   signals above 80 may identify a card outright.

The second is the more important lesson: the model was already telling us how
sure it was, in prose, and the code ignored it. Asking for that certainty as
structured data turned an overconfident guess into a correct answer.

## 11. Where to resume — as of 2026-09-01, end of day

**One blocker, and it is not code: the Anthropic API account has no credit.**

Everything else is built, deployed and verified. The vision scanner has never
completed a single successful scan, purely because the API refuses the request
with `Your credit balance is too low`.

### The billing trap that cost the evening

Sterling bought **$40 of "usage credits" on his Claude Max subscription**. Those
are for the Claude *app* when it hits a plan limit. **The API cannot spend
them.** API usage needs separate prepaid credit bought at
**console.anthropic.com**, which is a different product with a different
balance on a different site.

The tell: the subscription screen says *"keep using Claude if you hit a plan
limit"* and shows a reset date. API credit is a plain dollar balance with no
plan or reset.

**To resume:** buy API credit at console.anthropic.com (\$5 is ~400 scans),
confirm `pok-ai-drab.vercel.app` shows no amber setup banner, then scan. No code
changes are required.

Sterling is also asking Anthropic support whether the \$40 can be transferred
or refunded. That is unresolved and does not block anything.

### What is confirmed working

| | |
|---|---|
| Supabase schema, RLS tested three times | ✅ |
| tcgapi.dev connected, key live, returns real data | ✅ |
| Scanner ported, 26 tests passing | ✅ |
| Vision endpoint built, wired, key valid and authenticating | ✅ |
| Deployed at `pok-ai-drab.vercel.app` | ✅ |

The vision key IS valid — the API authenticated it and rejected only on
balance. That is the last thing proven before stopping.

### Bugs found by field testing on a real phone, all in one evening

None were findable from the development environment, and every one passed the
full test suite:

1. **Build preset** — the project was configured as a static site, so merging
   the rebuild would have served no site at all. Fixed by pinning
   `framework: nextjs` in `vercel.json`.
2. **Dropped guided crop** — the port sent the whole camera frame, so OCR read
   the wall behind the card rather than the card.
3. **Broken API contract** — the new `/api/search` shape silently degraded the
   live app to "Unknown Set" with no card art.
4. **Wrong page** — three test rounds ran against the original OCR app because
   it was still served at `/`. Fixed by making the rebuild the default.
5. **Masked API key** — a key copied out of Vercel's own display is dots, not a
   key, and produced an unreadable ByteString error.

**The lesson worth keeping:** 26 unit tests passed throughout every one of
these. They test the pieces; all five failures were in the seams between
pieces, or in the environment. Field testing on a real device found what the
test suite structurally could not.

## Rules for whoever edits this file next

1. Date it and name the commit you verified against.
2. Every claim is "verified", "not verified", or "could not check — here's why."
   There is no fourth category, and "the code looks right" is not verification.
3. Never delete a caveat to make the picture look better. That is how this file
   became wrong the first time.
