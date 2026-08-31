# Recognition pipeline — findings

These are results from building and debugging a working prototype scanner. They
are **findings, not specifications.** Where a number appears, the reasoning
behind it matters more than the number. If you can design something better,
do — but read the failure modes first, because several cost real hours to find
and are not obvious.

Important caveat: **none of this was validated against a labeled test set.** The
values below were reasoned into place from failure analysis, not measured. See
"What to build first" at the bottom.

Verified 2026-08-31 against the committed `index.html`:

- The thresholds described below **are implemented**: line 2081 reads
  `const preliminaryFloor = topValuePreview >= 100 ? 97 : 92;`.
- The confidence-ceiling bug **is fixed**. `computeConfidence()` (line 1947) is
  `nameScore` +8 for a card-number match, +6 for image similarity, and up to +5
  for capture quality. A perfect name match therefore reaches 100 and clears the
  97 floor, so auto-accept is genuinely reachable.
- The hard-timeout and real-error-text lessons **are implemented** —
  `withTimeout()` (line 1970) wraps each async step, a 60s overall ceiling wraps
  the whole pipeline (line 2247), and the real exception string is shown to the
  user (line 2297) rather than a generic message.
- **The retry-with-backoff mitigation is NOT implemented** in the committed
  build. It exists only in `prototype/pokai-app-bundled.html` as
  `fetchCardSearch()`. See `docs/STATUS.md` section 2.
- **The "show them all" rule is NOT implemented** in the committed build. This is
  the top open defect on the project. See `docs/STATUS.md` section 2.

None of this changes the caveat above: the numbers are implemented, but they
still have never been measured against real card photos.

## Approach used in the prototype

Browser-based OCR (Tesseract.js) reading the card's name region, then a text
search against a card database, then ranking candidates by name-match quality
with corroborating signals.

This was chosen because it needs no paid service and runs entirely client-side.
It is not necessarily the right long-term answer. A hosted image-recognition
model would likely be more accurate and much faster, at a cost. That tradeoff
is open — see `docs/OPEN-QUESTIONS.md`.

## Failure modes that actually happened

**Tesseract's worker is blocked by strict CSP.** In sandboxed iframe previews,
constructing the worker from a blob URL throws `SecurityError`. Not a code bug;
it works on a normally-served page. Don't chase it as one.

**Canvas taint kills image comparison silently.** Loading card art from a
cross-origin URL onto a canvas and then calling `getImageData()` throws. Any
perceptual-hash comparison against remote card images must handle this and treat
it as "signal unavailable" rather than as a failed match.

**The pipeline hung instead of erroring.** The original version had async steps
with no time limit, so a slow OCR pass or API call left the UI stuck forever with
no message. This was the single most damaging bug for trust, because it looked
like the app was broken rather than slow. **Every async step needs a hard
timeout**, and a timeout must produce a visible, specific message.

**Errors were swallowed and replaced with generic text.** Real exception messages
were caught and discarded, making remote debugging nearly impossible. Surface the
actual error string in the failure UI.

**First scan appeared broken because the OCR engine downloads on demand.** The
WASM bundle is several megabytes. Without warming it up in the background at page
load and telling the user "loading recognition engine (first scan only)," the
first scan looks like a hang.

**A single crop is not enough.** Cards vary in framing, lighting, and rotation.
Multiple crop fractions, plus an inverted-polarity retry for dark/holo cards,
plus a full-frame fallback, all measurably rescued reads that a single attempt
missed. Keep a full uncropped capture as a safety net alongside the guided crop.

## Confidence scoring — the reasoning

Name match is the dominant signal. Everything else corroborates.

The important lesson: **an earlier version of this formula made auto-accept
mathematically unreachable.** Penalties and weightings were tuned individually
until a perfect name match on a real card still topped out around 82 against a
92 threshold, so the scanner asked the user to confirm every single card. If you
design a scoring function, **prove the ceiling is reachable** — construct the
best realistic case and confirm it actually clears your threshold.

Signals used, in rough order of weight:
- Name match quality (dominant — an exact match should nearly carry the decision)
- Card number match (strong corroboration; a mismatch is strong evidence against)
- Image similarity via perceptual hash (bonus only — never let a missing or
  untrustworthy image signal *subtract* confidence, since it fails for benign
  reasons like CORS)
- Capture quality (small effect only)

Thresholds used: auto-accept at 92 normally, raised to 97 when the card's value
is $100 or more. The rationale for the higher bar on valuable cards: the cost of
a silent error scales with the card's value, so buy certainty where it matters.

**Number-based tie-breaking matters more than expected.** Many candidates share
an identical name score because the same Pokémon appears in dozens of sets. When
several tie, use the OCR'd card number to pick among *all* the tied candidates —
not just to check the top one. If the number resolves it uniquely, accept. If
not, show them all.

## Database reliability

The free public card API is genuinely unreliable — see `docs/CATALOG.md` for
measured numbers. Two mitigations proved worthwhile: retry with backoff on every
lookup, and preferring a local card catalog so the common path never depends on
a third party being up.

## What to build first

**A labeled accuracy test set.** Photograph a set of known cards under varied
conditions, record the correct answer for each, and build a harness that reports
accuracy and auto-accept rate. Without it, no confidence-tuning change can be
told apart from noise, and every number in this document remains a guess.

Still true as of 2026-08-31. Nothing of the kind exists in the repository, and
the scanner has never been observed reading a real card by anyone who wrote
these docs. Note the ordering dependency: the test set needs a card database to
match against, and the card database needs a backend to serve it — so the
backend comes first in build order, even though the test set is what makes every
later change measurable.
