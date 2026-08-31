# Open questions

Updated 2026-08-31 after the repository audit. Questions 2 and 3 have moved —
see the notes under each. A new blocking question 0 has been added, because it
outranks everything else here.

Decisions that are genuinely undecided. Do not silently pick one and build on it
— raise them with Sterling, in plain language, with a recommendation and the
tradeoff. He is non-technical, so lead with cost and consequence, not mechanism.

## Blocking — needed before real work

**0. Where is the backend code? (NEW — most urgent)**
Earlier notes describe an Express backend, a Supabase schema, and catalog
scripts. None of it is in this repository and none of it ever has been. If it
exists on a laptop or in another repo, it needs to be pushed now. If it cannot be
found, it is gone and will be rebuilt. This is a five-minute answer from Sterling
or Connor that changes what gets built first. See `docs/STATUS.md` section 2.

**0b. What is the Netlify URL? (NEW)**
Sterling believes the app is hosted on Netlify. I could not verify this. If a
site is live, its card lookups are certainly broken, because the committed app
calls `http://localhost:3001`.

**1. Web app or native mobile app?**
Scanning is a phone activity. A web app is faster to build and deploy and works
everywhere; a native app gets better camera control and app-store presence.
This decision shapes everything else.

**2. Rebuild or extend the prototype?**
The prototype is a single ~3,400-line HTML file. It works but has no persistence
and no structure to grow into. Your call — but explain the reasoning and the
cost in time before starting either way.

*2026-08-31 recommendation: extend, don't rebuild.* The audit found the OCR
pipeline is real, substantial, and already carries several hard-won fixes
(timeouts, multi-crop, inverted-polarity retry, real error text). Rebuilding
throws that away and re-earns the same bugs. The missing pieces — persistence,
accounts, a card database — are all things a backend adds *behind* this file
without rewriting it. Revisit if and when the single file becomes the thing
slowing work down.

**3. Where does it get hosted, and who pays?**
Sterling has a Netlify account and believes something is deployed there; this
could not be verified — see question 0b. GitHub Pages is confirmed off. Netlify
remains the path of least resistance for the front end and is free at this
scale; the open part is the backend and database, which Netlify does not
provide in the form this project needs. Anything with a database and server needs
a real hosting decision and a real (probably small, but nonzero) monthly cost.
He needs to approve spending before it's incurred.

**4. Recognition approach: free client-side OCR, or a paid vision service?**
The prototype used free browser OCR. A hosted vision model would likely be more
accurate and faster, but costs per scan and needs a server to hold the key.
Accuracy is the product's core promise, so this deserves real thought rather
than defaulting to whatever is cheapest.

## Important, not yet blocking

**5. Where does pricing data come from?**
The free card API bundles some market pricing, but licensing for commercial use
is unclear. If PokAI charges money and displays market values, the source needs
to permit that. This is a legal/licensing question, not just a technical one,
and it is worth resolving early rather than after launch.

**6. Card images and copyright.**
Card art is owned by The Pokémon Company. Displaying images fetched from a
third-party API in a commercial product is a real legal question. Flag it; don't
quietly bake in an approach that assumes it's fine.

**7. Accounts and data ownership.**
No auth exists. Once collections persist, this becomes a real product with real
user data — which brings security and privacy obligations. Worth designing
deliberately rather than bolting on.

**8. What "condition tracking" means concretely.**
Listed as MVP, but never specified. Self-reported condition grade? Photo-based
assessment? Grading-service integration? Needs definition before building.

## Context worth knowing

Sterling has been burned by confident claims that turned out to be untrue — code
described as working that had never run, and fixes announced without
verification. Being told "I haven't verified this yet" is genuinely more useful
to him than a confident answer that might not hold. Err toward saying so.
