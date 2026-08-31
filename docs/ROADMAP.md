# Roadmap to production

Written 2026-08-31. Ordered by dependency, not by preference — each phase
unblocks the next. Time estimates are working time, not calendar time.

Full technical reasoning is in `docs/ARCHITECTURE.md`. What Sterling needs to
do is in `docs/SETUP-CHECKLIST.md`.

---

## Phase 0 — Fix what's broken. No accounts, no cost.

Can start immediately; nothing here is blocked on Sterling.

1. **Fix the never-guess violation.** The committed app shows no candidate list
   on a low-confidence scan and truncates to 8 when ambiguous. The correct
   version already exists in `prototype/pokai-app-bundled.html`. Port it.
2. **Reconcile the two app versions** into one file, keeping the retry logic and
   placeholder art that were written but never committed.
3. **Make the backend address configurable** instead of hardcoded to
   `http://localhost:3001`, which cannot work on a deployed site.

**Result:** one honest, deployable front end. Still no persistence.

---

## Phase 1 — Backend and card data. *Needs Sterling.*

Blocked on: Netlify connected, Supabase account, tcgapi.dev key.

1. Create the Supabase database and the tables in `docs/ARCHITECTURE.md`.
2. Build the API on Netlify Functions: card search, card lookup, health check.
3. Build the **sync job** — nightly prices, weekly new sets — writing every price
   with its source and fetch time.
4. Point the app at the real API and deploy it.

**Result:** the app runs on a real URL, on a real card database, with real
prices that refresh on their own. The camera works, because Netlify serves
HTTPS. This is the first version worth showing anyone.

---

## Phase 2 — Real recognition. *Needs an Anthropic API key.*

1. Add a server-side `/api/identify` endpoint calling Claude Haiku 4.5 vision.
2. Return structured card data, match it against our catalog, score confidence.
3. Keep the never-guess behaviour intact end to end.
4. **Build the accuracy test set** — photograph known cards under varied
   conditions, record the right answer, and report accuracy and auto-accept rate.

Point 4 is the one most likely to get skipped and the one most worth protecting.
Without it, nobody can tell whether a change to recognition helped or hurt, and
every confidence number in `docs/SCANNER.md` stays a guess. It is also what
decides Haiku vs. Sonnet on evidence rather than vibes.

**Result:** the scanner actually reads cards, and we can prove how well.

---

## Phase 3 — Accounts and persistence.

1. Supabase Auth: sign up, log in, password reset.
2. Save collections, scan history, and portfolio value per user.
3. Capture corrections when a user fixes a misidentification.
4. Verify row-level security — that a user can reach only their own data. This
   gets tested deliberately, not assumed.

**Result:** closing the tab stops deleting everything. This is the point where
PokAI becomes a product rather than a demo.

---

## Phase 4 — Production hardening.

Rate limiting per user; scan photo storage; real error surfacing; monitoring and
alerts; a backup policy; and a decision on the two legal questions in
`docs/OPEN-QUESTIONS.md` — card image copyright and pricing-data licensing.
Those are lawyer questions, not engineering ones, and they want answering before
money changes hands, not after.

---

## Running cost

| | Development | Live product |
|---|---|---|
| Netlify | $0 | $0 until real traffic |
| Supabase | $0 | $0, then $25/mo at scale |
| tcgapi.dev | $0 free tier | **$49.99/mo — commercial licence required** |
| Claude vision | pennies | ~$2.50 per 1,000 scans (to be measured) |
| **Total** | **~$0** | **~$50/mo + usage** |

The one unavoidable cost is tcgapi.dev's Pro plan. Their Free, Hobby and Starter
tiers are licensed for personal and non-commercial use only; PokAI is a
commercial product, so Pro at $49.99/mo is the first tier that legally fits.
Building and testing can happen on the free tier first.

---

## Sequencing note

Phase 0 needs nothing from Sterling and can proceed now. Everything after it is
gated on accounts. The single highest-value thing Sterling can do is Phase 1's
three accounts — that unblocks the entire rest of the plan.
