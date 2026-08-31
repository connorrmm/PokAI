# Open questions

Updated 2026-08-31 after the repository audit. Questions 2 and 3 have moved —
see the notes under each. A new blocking question 0 has been added, because it
outranks everything else here.

Decisions that are genuinely undecided. Do not silently pick one and build on it
— raise them with Sterling, in plain language, with a recommendation and the
tradeoff. He is non-technical, so lead with cost and consequence, not mechanism.

## Blocking — needed before real work

**0. Where is the backend code? — ANSWERED 2026-08-31**
It never existed as files. All prior work was done in Claude chat sessions and
pasted into the single HTML file by hand; Claude Code was never used. Nothing to
recover, nothing to migrate. The backend gets built fresh per
`docs/ARCHITECTURE.md`. **Closed.**

**0b. Is anything deployed? — ANSWERED 2026-08-31: no.**
Sterling moved from Netlify to Vercel and connected it. The Vercel account holds
zero projects and GitHub Pages is off, so nothing is live. **Closed.**

**1. Web app or native mobile app? — DECIDED 2026-08-31: web app.**
It runs on every phone with no app-store review, deploys in seconds, and the
camera works fine in a mobile browser over HTTPS. A native app costs
substantially more to build and maintain and buys us nothing we need yet.
Revisit if the web version proves limiting in real use. **Closed unless
challenged.**

**2. Rebuild or extend the prototype? — DECIDED 2026-08-31: extend.**
The prototype is a single ~3,400-line HTML file. It works but has no persistence
and no structure to grow into. **Closed unless challenged** — reopen it if the
single file becomes what is slowing work down.

*Reasoning:* The audit found the OCR
pipeline is real, substantial, and already carries several hard-won fixes
(timeouts, multi-crop, inverted-polarity retry, real error text). Rebuilding
throws that away and re-earns the same bugs. The missing pieces — persistence,
accounts, a card database — are all things a backend adds *behind* this file
without rewriting it. Revisit if and when the single file becomes the thing
slowing work down.

**3. Where does it get hosted, and who pays?**
**DECIDED 2026-08-31: Vercel + Supabase.** Both are connected, and the database
is built and secured. Vercel hosts the front end and the API; Supabase is the
database and handles logins.

*Cost, now concrete:* ~$70/month at launch — Vercel Pro $20, tcgapi.dev Pro
$49.99, Supabase free until scale — plus roughly $2.50 per 1,000 scans. **$0
during development.** Both Vercel Pro and tcgapi.dev Pro are licence
requirements rather than capacity ones: each vendor's free tier forbids
commercial use. **Closed.** Anything with a database and server needs
a real hosting decision and a real (probably small, but nonzero) monthly cost.
He needs to approve spending before it's incurred.

**4. Recognition approach — DECIDED 2026-08-31: paid vision model, server-side.**
Accuracy is the product's core promise, and free browser OCR is the weakest link
in the whole system — it cannot reliably read the foil and holo cards that matter
most. Starting with Claude Haiku 4.5, the cheapest current model that reads
images, at an estimated ~$2.50 per 1,000 scans (**to be measured, not assumed**).
Moving up to Sonnet 5 at roughly double the cost is a one-line change, and that
call should be made from the accuracy test set, not from guesswork.
See `docs/ARCHITECTURE.md`. **Closed pending measurement.**

*Still genuinely open within this:* which model, decided by measured accuracy
once the test set exists.

## Important, not yet blocking

**5. Where does pricing data come from? — PARTLY ANSWERED 2026-08-31.**
Provider chosen: **tcgapi.dev**, which Sterling identified as the live API. It
supplies card data and daily market values across Pokémon and other games.

The licensing part is now concrete rather than vague: their Free, Hobby and
Starter tiers are for personal and non-commercial use only. **Commercial use
requires the Pro plan at $49.99/mo.** PokAI is commercial, so that is the tier
we need before launch — not before building.

*Still open:* whether their commercial licence also covers redistributing prices
the way we intend to display them. Worth reading their terms properly, or having
a lawyer do it, before charging users.

*Not yet verified by me:* tcgapi.dev is blocked by my sandbox's network policy,
so everything above comes from their public pages via search, not from calling
the API. **First job once a key exists: confirm the API actually returns what we
need.**

**6. Card images and copyright — SHARPENED 2026-08-31, still open.**
Card art is owned by The Pokémon Company. tcgapi.dev's licence is now read and
is explicit that it does not help here:

> "Card artwork is copyrighted by the respective game publishers — we do not and
> cannot grant you rights to the artwork itself... it's your responsibility to
> assess; you can build on our pricing data without displaying images at all."

So this is Sterling's call, not a risk the data vendor absorbs. Two things that
make it less frightening than it sounds:

1. **Images are hosted by TCGPlayer**, so we would be linking to their servers
   rather than copying and storing Pokémon artwork ourselves. That is a
   materially better position than hosting it.
2. **The product works without images.** Names, sets, numbers, rarities and
   prices all come through independently. A text-and-price version of PokAI is
   fully functional. Worth remembering before treating this as a blocker.

*Recommendation:* build image display behind a switch that can be turned off,
so a legal answer either way does not require a rewrite. Get the legal read
before charging money, not before writing code.

**7. Accounts and data ownership.**
No auth exists. Once collections persist, this becomes a real product with real
user data — which brings security and privacy obligations. Worth designing
deliberately rather than bolting on.

**8. What "condition tracking" means — DECIDED 2026-08-31.**
Sterling had no view on this, so the call is mine.

*What it is, plainly:* the physical wear on a card. Collectors grade it on a
standard five-step scale — Near Mint, Lightly Played, Moderately Played, Heavily
Played, Damaged — and it moves value enormously. The same card can be worth
several times more in Near Mint than Damaged. A collection valued without
condition is not really valued at all.

**Decision: the user picks the condition from the five standard grades.**

*Why the simple version is also the right one:* tcgapi.dev already returns
**per-condition prices** (NM/LP/MP/HP/Damaged). So a dropdown is not a
placeholder for something better — it feeds directly into a genuinely accurate
valuation using data we already pay for. It is roughly a day of work and it
makes the portfolio number real.

**Default is "not set", never "Near Mint".** Defaulting to the best grade would
silently inflate every collection's value, which is fabricating a number — rule
2. An unset card shows a value range, or no value, and asks.

**Explicitly not doing: assessing condition from the photo.** It is genuinely
hard — surface scratches, edge whitening and centring do not survive a phone
camera reliably — and being confidently wrong about condition produces a
confidently wrong valuation. That is precisely the failure the never-guess rule
exists to prevent, and here it would be quieter and more damaging, because a
wrong price looks plausible in a way a wrong card name does not. Professional
graders charge real money for this judgement, which is the tell.

**Explicitly not doing for MVP: grading-service integration** (PSA, BGS, CGC).
Real feature, different product, revisit after launch. The schema already has
room: `collections.condition` is free text, so a graded slab can later be
recorded as its own value without a migration.

*Possible later, and worth keeping in mind:* the photo is already captured and
stored. If a labelled set of condition-graded photos ever accumulates,
suggesting a condition — clearly marked as a suggestion the user confirms —
becomes defensible. Suggesting is not the same as deciding. **Closed.**

## Context worth knowing

Sterling has been burned by confident claims that turned out to be untrue — code
described as working that had never run, and fixes announced without
verification. Being told "I haven't verified this yet" is genuinely more useful
to him than a confident answer that might not hold. Err toward saying so.
