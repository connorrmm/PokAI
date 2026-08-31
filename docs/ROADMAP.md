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

Vercel and Supabase are connected and the database schema is live (2026-08-31).
Remaining blocker: none for the API build; the tcgapi.dev key is in hand.

1. ~~Create the Supabase database and tables.~~ **DONE 2026-08-31** — schema
   applied, row-level security enabled and verified by test. See
   `supabase/README.md`.
2. Build the API on Vercel Functions: card search, card lookup, health check.
3. Build the **sync job** — nightly prices, weekly new sets — writing every price
   with its source and fetch time. Runs on Vercel Cron.
4. Point the app at the real API and deploy it.

Step 2 starts with one unglamorous task: **confirm tcgapi.dev actually returns
what we need.** Its plans and endpoints were researched from public pages, never
from a real call, because this environment blocks the domain. Building the sync
job on an unverified assumption is exactly the mistake this project has already
paid for once.

**Result:** the app runs on a real URL, on a real card database, with real
prices that refresh on their own. The camera works, because Vercel serves
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
| Vercel | $0 Hobby | **$20/mo Pro — commercial licence required** |
| Supabase | $0 | $0, then $25/mo at scale |
| tcgapi.dev | $0 free tier | **$49.99/mo — commercial licence required** |
| Claude vision | pennies | ~$2.50 per 1,000 scans (to be measured) |
| **Total** | **~$0** | **~$70/mo + usage** |

Two of these are licence requirements rather than capacity limits, and both bite
at launch rather than during development:

- **tcgapi.dev Pro, $49.99/mo.** Free, Hobby and Starter are licensed for
  personal and non-commercial use only.
- **Vercel Pro, $20/mo.** Vercel's Hobby plan is likewise non-commercial only;
  their fair-use terms define commercial as any deployment used for financial
  gain by anyone involved, which PokAI plainly is.

That is $20/mo more than the earlier Netlify-based estimate, because Netlify's
free tier does allow commercial use and Vercel's does not. Worth knowing; not
worth switching back over, since $20/mo is small next to the time cost of
changing platforms again.

---

## Sequencing note

Phase 0 needs nothing from Sterling and can proceed now. Everything after it is
gated on accounts. The single highest-value thing Sterling can do is Phase 1's
three accounts — that unblocks the entire rest of the plan.
