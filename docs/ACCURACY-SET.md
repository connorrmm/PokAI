# Accuracy test set

`docs/SCANNER.md` has called a labelled accuracy set the highest-value task on
this project since before any of this code existed. Without one, no change to
recognition can be told apart from noise, and every tuned number is a guess.

This is the beginning of it. Reference photo: `docs/accuracy/set-01-six-cards.jpg`.

## The rule

**The scanner never sees this file.** Ground truth exists so results can be
graded, not so the app can cheat. A scanner told the answer in advance proves
nothing.

## Set 01 — recorded 2026-09-02

Read from the reference photo, except where marked *verified from the card*,
which means Sterling read it off the physical card. Entries marked *uncertain*
were not fully legible and still need that treatment.

**One entry here was already wrong.** Flareon was recorded as `017/131` from
the photo; the card says `013/131`. An answer key read from a photograph is
subject to the same misreads as the scanner it is grading, which makes it worse
than useless — it grades a correct answer as wrong. Every number in this table
should end up verified from the physical card.

| # | Card | Number | Set | Why it is in the set |
|---|---|---|---|---|
| 1 | Mega Pyroar ex | 015/086 *verified from the card* | Mega Evolution era | Full art, heavy foil, large HP |
| 2 | Goldeen | 118/165 | SV: 151 | Plain common — the boring case that must not break |
| 3 | Flareon | **013/131** *verified from the card* | Prismatic Evolutions | Stage 1, ordinary rare |
| 4 | Dipplin | 010/131 *verified from the card* | Prismatic Evolutions | Uncommon, busy artwork |
| 5 | **Mega Greninja ex** | — | **JAPANESE** | The hard case. See below. |
| 6 | Kangaskhan ex | **190/165** *verified from the card* | SV: Scarlet & Violet 151 | Secret rare: number exceeds the set total |
| 7 | Froakie | **088/086** *verified from the card* | Cosmos Holo promo | Second secret rare; the card the ordering bug was found on |

## What each card is actually testing

**Card 2 (Goldeen)** — commons are the bulk of any real collection and get the
least attention in card databases. A scanner that only works on chase cards does
not work.

**Cards 3 and 4** — both Prismatic Evolutions, both ordinary. These should be
the easy path. If they fail, something is broadly wrong.

**Card 5 (Japanese Mega Greninja ex)** — **expected to fail, and that is the
point.** tcgapi.dev sources from TCGPlayer, which is an English-language
marketplace. A Japanese card may return no match at all.

The right behaviour is to say so plainly, not to guess at an English card with
similar artwork. A confident wrong answer here is far worse than "no match" —
Japanese prints have completely different values from their English
counterparts, so a wrong match corrupts both the card and its valuation.

This raises a real product question for Sterling rather than a bug for me:
**does PokAI support Japanese cards?** Collectors hold plenty of them. If yes,
it needs a data source that covers them, which tcgapi.dev may not.

**Card 6 (Kangaskhan ex)** — a secret rare, `190/165`: the card number is
HIGHER than the set total. That shape breaks the natural assumption that a
numerator never exceeds a denominator, and any validation written on that
assumption would silently reject a card the collector actually owns — and
secret rares are the expensive ones.

`extractCardNumber()` handles it, because it never compares the two. Worth
keeping as a test precisely so nobody later "fixes" it by adding that check.

*(This entry previously read `040/A063`, testing "unusual A-prefixed
numbering". That number does not exist. I misread it from a photograph and then
wrote a paragraph of analysis about a card format I had invented.)*

**Card 1 (Mega Pyroar ex)** — heavy foil across the whole card is the classic
glare case, and the one traditional OCR could never handle.

## Recording results

For each scan record: what the app said, whether it auto-accepted or offered a
list, where the correct card ranked, the confidence, and the cost.

Three outcomes, in order of how much they matter:

1. **Confidently wrong** — auto-accepted the wrong card. The failure the
   never-guess rule exists to prevent. Any instance is a stop-and-fix.
2. **Asked when it should not have** — correct card in a list it could have
   named outright. Tuning.
3. **Could not read it** — no candidates. Recoverable; the user can search.

---

## Results — run 01, 2026-09-02, claude-haiku-4-5

| # | Card | Outcome | Correct card in list? | Candidates | Number read? |
|---|---|---|---|---|---|
| 1 | Dipplin | asked | **yes, 1st** | 10 | no |
| 2 | Goldeen | asked | **yes, 4th** | 26 | no |
| 3 | Kangaskhan ex | asked | unconfirmed | 22 | no |
| 4 | Mega Pyroar ex | asked | **yes, 1st** | 2 | no |
| 5 | Mega Greninja ex (JP) | no match | no — misread as "Kyogre-ex" | 0 | no |
| 6 | Flareon | asked | **yes, 1st** | 50 | no |

**Zero confidently wrong answers.** Nothing was auto-accepted that should not
have been. The never-guess rule held on every card, which is the result that
matters most — a wrong card silently added to a collection is the failure this
product cannot afford.

**Zero auto-accepted, either.** Every scan asked the user. That is honest but it
is not the product: scanning a binder should not mean tapping through a
50-option list each time.

### The single cause: the collector number was never read

**All six scans reported number certainty of 0%.** The model said why, every
time, in almost the same words:

> *"Collector number is obscured by angle and glare on the foil card, making
> digits unreadable."*
> *"Photographed at an angle with shadows and glare affecting the lower
> portion."*
> *"The collector number at bottom is too blurred to read with confidence."*

Without the number nothing can uniquely resolve a print, so every scan falls
back to a list — exactly as designed, and exactly why the lists are so long.
The Eevee ex that worked is the one scan where the number WAS read.

**A large part of this is my doing.** Photos are downscaled to 1400px before
upload to control cost. A collector number occupies roughly 2% of a card's
height, so after downscaling it is a handful of pixels tall — genuinely
unreadable, however good the model. The cost optimisation quietly destroyed the
signal that decides which print you own.

### Other findings

**Japanese cards fail, as predicted — but for a different reason.** The
prediction was "no match in an English database". What actually happened is the
model misread the name entirely as *"Kyogre-ex"* at 75% confidence, then found
nothing. No harm done (zero results rather than a wrong card), but the failure
was earlier in the chain than expected.

**Kangaskhan ex `040/A063`** — the prediction that `extractCardNumber` would
reject a letter in the denominator was not tested, because the number was never
read at all.

**Cost and speed are better than the comparison suggested:** $0.0035 per scan
(**$3.50 per 1,000**) at 4.6s, against $6.56 and 10.9s in the model comparison.
Output tokens dropped once the model had less to describe.

### What this changes

Number reading is the bottleneck, not model choice, not the never-guess logic.
Fix it and Dipplin, Mega Pyroar and Flareon all become direct identifications
rather than lists of 10, 2 and 50.

### The fix, shipped 2026-09-02 — a magnified bottom strip

The scanner now sends **two** images per scan instead of one:

1. The whole card, downscaled to 1400px, as before.
2. A crop of the bottom 32% of the card, taken from the **original** photo
   before any downscaling, re-encoded at up to 1568px wide.

The second image is labelled for the model as the place to read the number
from. Cropping from the original is the entire point — cropping the downscaled
copy would recover nothing, because the pixels were already thrown away.

Why 1568px: digit sharpness is decided by output width divided by original
width, and nothing else. 1568px is the largest edge the API keeps; anything
wider is downscaled on arrival and paid for twice. Against the 1400px-longest-
edge full-card path this gives the digits roughly **2.5x the pixels**.

**Cost:** about 1,500 extra input tokens, roughly $0.0015 a scan, taking a scan
from ~$0.0035 to ~$0.005 — **$5 per 1,000 instead of $3.50**. Worth it if it
turns a fifty-card list into one card. If it does not raise number certainty in
run 02, revert it rather than pay for nothing.

**Not yet verified against real cards.** It compiles, typechecks, and the 36
never-guess tests pass, but the only test that counts is rescanning these same
six cards. Run 02 measures: number certainty per card, candidates per card, and
cost per scan.

---

## Results — run 02, 2026-09-02, with the bottom strip

| # | Card | Number certainty | Number read | Candidates | Change from run 01 |
|---|---|---|---|---|---|
| 1 | Dipplin | 0% | — | 10 | none |
| 2 | Goldeen | 0% | — | 26 | none |
| 3 | Kangaskhan ex | 0% | — | 22 | none |
| 4 | Mega Pyroar ex | **65%** | `075/086` (**wrong**) | 2 | number read for the first time |
| 6 | Flareon | 0% | — | 50 | none |

Cost rose from $0.0035 to ~$0.0047 a scan, as predicted.

**The strip is reaching the model.** Every scan now comments on it specifically
— *"the bottom magnified crop is too blurry"*, *"the second image is severely
out of focus and overexposed"*. That is a different failure from run 01, where
the model never mentioned a crop at all.

**One card in five improved, and its number was wrong.** Mega Pyroar read
`075/086`; the real card is `015/086`. The never-guess rule handled this
correctly — confidence fell from 94% to 59% because the number matched no
candidate, and both prints were still offered rather than one wrong one. A
misread number is caught, not trusted. But it is not an identification.

### The real cause, found by arithmetic rather than by looking

Every scan in run 02 reported **3,929 input tokens — identical to the digit.**
Identical token counts mean identical image dimensions, which means every photo
came from the camera path at a fixed capture size. That single number is what
made the cause findable.

The camera was requesting **1080p**. Work it through:

| | |
|---|---|
| Capture height | 1080px |
| Card fills roughly half the frame | ~1050px of card |
| Collector number is ~2% of a card's height | **~21px of digits** |
| After the strip's 2x magnification | ~42px of *interpolated* digits |

**21 pixels is not blur. It is an absence of pixels.** No model reads a
collector number that was never captured, and magnifying it afterwards enlarges
the mush without adding information. Mega Pyroar succeeding once is what you
would expect right at the edge of legibility — sometimes the coin lands heads.

This was my error twice over: first the 1400px downscale, then diagnosing the
result as focus when the source was the constraint all along.

### The fix, shipped 2026-09-02 — capture at 2160p

The camera now asks for 3840x2160 instead of 1920x1080, and enables continuous
autofocus where the device supports it. Those same digits are captured about
**40px tall instead of 21px**.

It costs nothing per scan. The uploaded card image is downscaled to 1400px
either way; the extra pixels are spent on the magnified bottom crop and then
discarded. `ideal` rather than `exact`, so a phone that cannot manage 4K gives
its best rather than failing to open the camera.

**A new diagnostic row makes this measurable instead of arguable.** Every scan
now reports the estimated pixel height of the collector number in the crop it
sent, and flags anything under 25px as too little detail to read. Run 03 should
show that figure roughly doubling. If it does not, the phone refused the
resolution request and the answer is to photograph cards with the native camera
app and upload them, which captures at full sensor resolution.

**Not verified.** Typechecks, builds, 36 tests pass. Whether a phone honours a
4K request can only be found out on a phone.

---

## Results — run 03, 2026-09-03, capturing at 2160p

### The capture fix worked exactly as predicted

| | Run 02 | Run 03 |
|---|---|---|
| Digit height in the crop | ~21px (calculated) | **44px (measured)** |
| Photo size | 1080p frame | **1446x2020 card crop** |
| Number read on Flareon | not at all | `071/131` at 75% |

Flareon went from "the collector number is heavily obscured, digits cannot be
distinguished" to reading a specific number with a specific stated doubt:
*"could be 071 or possibly 041, though 071 is most likely."* That is the
difference between no signal and a noisy one.

### It still returned all 50 candidates, for a reason worth writing down

**The number was read and was still wrong.** Three sources disagree:

| Source | Number |
|---|---|
| The model, from the photo | `071/131` |
| This file's ground truth, read from the reference photo | `017/131` |
| The catalog's only /131 Flareon | `013/131` |

Three different numerators — and **all three agree on `/131`**. That is not
chance. The numerator is one to three small digits where a single misread glyph
ruins it; the set total is a fixed three-digit group repeated on every card in
the set, and it survives glare.

**Which means this file's own ground truth is suspect.** `017/131` was read by
me from a photograph, in exactly the conditions that just produced a misread.
It is marked as certain and probably should not be. **Sterling needs to read
the number off the physical card**, because the accuracy set is worthless if
its answers are guesses too.

### The fix, shipped 2026-09-03 — rank by set total

When the full number matches no candidate, candidates are now reordered so that
those from a set of the right size come first. For this Flareon that is 4 cards
out of 50: the Prismatic Evolutions print, its Master Ball and Poke Ball
patterns, and the Cosmos Holo.

**Reorder only — nothing is removed from the list.** A misread total must never
be able to hide the right card from the user; that dead end is the exact
failure the never-guess rule exists to prevent.

Those four remaining cards are worth $0.33, $29.66, $2.16 and $1.31. They are
the same card number in the same set and differ only by holo pattern, so the
number cannot separate them and no amount of number-reading will. That is a
genuine question for the user, or a future signal — the patterns are visibly
different and a vision model can see them.

### A dead code path found while reading run 03

`uniquelyResolved` in `app/api/identify/route.ts` requires the number AND the
set name to each be read at 80% certainty or better. **Set confidence has been
15%, 15%, 15%, 15%, 15% and 35% across every scan ever recorded.** Set symbols
are small printed icons and the model has never once read one.

So that branch can never execute. It is a gate built with a lock that has no
key. Auto-accept still works by the other path (`isClearlyBest`), which is how
the Eevee ex was identified at 99%, so nothing is broken — the extra path
simply never fires.

**Deliberately not fixed yet.** The obvious change is to let a confidently-read
number identify a card alone. But both numbers read so far were WRONG, at 65%
and 75% — and the 80% floor correctly rejected both. Two data points is not
enough to bet the never-guess rule on. The decision needs a scan that reports
80%+ number certainty, checked against the physical card. Recorded here so it
is a decision rather than an oversight.

### Cost

$0.0057 a scan (4,726 in / 188 out), up from $0.0035 before the bottom strip.
The rise is the strip plus the larger source photo. Still under a cent.

---

## Ground truth correction — 2026-09-03

**Flareon is `013/131`, read off the physical card by Sterling.**

Three things follow, and the middle one is the important one.

**1. The catalog is right.** tcgapi.dev lists the Prismatic Evolutions Flareon
as `013/131` and that is exactly what the card says. This was an open worry —
if the catalog had been wrong, no amount of scanner work would have helped. It
is not. Card data can be trusted.

**2. This file was wrong.** The answer key said `017/131`, because I read it off
a photograph. **An answer key read from a photo is subject to the same misreads
as the scanner it grades.** Had this gone unnoticed, a scan that correctly
returned `013/131` would have been recorded as a failure, and I would have spent
real effort "fixing" a scanner that was right. Every remaining number in the set
that was read from the photo is suspect for the same reason.

**3. The set-total fix is validated.** The true card is `013/131`, so it is one
of the four `/131` candidates the new ranking lifts to the top of a 50-card
list. The model's `071/131` was wrong in the numerator and right in the total —
precisely the case the fix was built for.

The model's error is worth noting: `013` read as `071`. Not a single blurred
glyph but a scrambling of the digits, with `041` offered as its alternative. It
is reading digits that are present and putting them in the wrong order, which
is a different failure from not seeing them, and it will not be fixed by more
pixels.

### Still needed from the physical cards

| # | Card | Recorded | Status |
|---|---|---|---|
| 1 | Mega Pyroar ex | 015/086 | from photo — **needs checking** |
| 3 | Flareon | 013/131 | ✅ verified from the card |
| 4 | Dipplin | 010/131 | from photo, marked uncertain — **needs checking** |
| 6 | Kangaskhan ex | 040/A063 | from photo, marked uncertain — **needs checking** |

Mega Pyroar matters most: the model read `075/086` and this file says `015/086`.
That is the same `1`/`7` confusion that just turned out to be MY error on
Flareon, so it cannot be assumed the model is the one that is wrong.

---

## The answer key is now verified — 2026-09-03

All four readable numbers confirmed by Sterling from the physical cards.

| # | Card | I recorded, from the photo | Actually printed | |
|---|---|---|---|---|
| 1 | Mega Pyroar ex | 015/086 | `015/086` | ✅ |
| 3 | Flareon | 017/131 | `013/131` | ❌ |
| 4 | Dipplin | 010/131 | `010/131` | ✅ |
| 6 | Kangaskhan ex | 040/A063 | `190/165` | ❌ |

**I read two of four wrong from a photograph.** The same failure rate I have
been measuring the scanner against, using those readings as the standard of
truth. This is the most important thing in this file: *the answer key was as
unreliable as the thing it was grading, and nothing built on it could be
believed.* Ground truth now comes from the physical card or it is not ground
truth.

The Kangaskhan error was the worse one. `040/A063` is not a real number — I
invented it — and then wrote a paragraph analysing how `extractCardNumber()`
would handle "A-prefixed numbering", a card format that does not exist. A wrong
fact grew a plausible explanation around itself. Predictions in this file are
worth exactly as much as the observations under them.

### The open question from run 01, answered

**Was the correct Kangaskhan ex in its 22-card list? Yes.**

The card is `190/165`, and `Kangaskhan ex - 190/165, SV: Scarlet & Violet 151,
Ultra Rare, $5.58` was 8th of the 22 offered. So the catalog is complete here
too, and the failure was ranking, not coverage. That distinction matters: a
coverage gap needs a new data source, while a ranking problem is ours to fix.

**And the set-total ranking should fix this one outright.** Of the 22
candidates only two are from a 165-card set — `115/165` and `190/165`. A
correct read of the total alone takes 22 down to 2.

### What each card should now do

| Card | Number | Set total narrows to | Was |
|---|---|---|---|
| Mega Pyroar ex | 015/086 | 2 | 2 |
| Flareon | 013/131 | 4 | 50 |
| Dipplin | 010/131 | 4-ish | 10 |
| Kangaskhan ex | 190/165 | **2** | 22 |

These are predictions, not results, and this file has just demonstrated what
predictions are worth. Run 04 measures them.

### Corrected model accuracy on the numbers

With a trustworthy key, what the model actually read:

| Card | Model read | Truth | |
|---|---|---|---|
| Mega Pyroar ex | `075/086` | `015/086` | wrong numerator, right total |
| Flareon | `071/131` | `013/131` | wrong numerator, right total |

Two for two on the set total, nought for two on the numerator — and in both
cases the model volunteered its doubt (*"could be 071 or possibly 041"*) rather
than asserting. The `1` becomes a `7` both times. That is a specific,
repeatable confusion in a specific glyph, not general blur, and it is now the
clearest target left in number reading.

---

## Run 04, 2026-09-03 — the first perfectly read number, and why it still asked

**Kangaskhan ex read as `190/165`. Exactly right**, confirmed against the
physical card. The correct print ranked 1st of 22 at 99% confidence.

**And the app still asked the user to pick.** Not because of the confidence
score — 99 cleared the bar of 92 comfortably. `decide()` requires two things:
confidence above the floor, AND one candidate standing clearly above the rest.
All 22 candidates are named "Kangaskhan ex", so on name alone nothing stands
out. The number was what made one stand out, and the code refused to count it
unless the set symbol was ALSO read at 80% certainty — which has never once
happened.

### The model's certainty about numbers is not a usable signal

With ground truth verified from the physical cards, its self-assessment points
the wrong way:

| Stated certainty | Read | Truth | |
|---|---|---|---|
| 45% | `190/165` | `190/165` | **correct** |
| 65% | `075/086` | `015/086` | wrong |
| 75% | `071/131` | `013/131` | wrong |

The most confident read was wrong; the least confident was right. Three points
is not a law, but it is more than enough to stop using a signal that has never
once pointed the right way.

### What replaced it: ask the catalog, not the model

Check whether the number read matches exactly one card in the database. On the
same three scans:

| Read | Cards carrying that number | Verdict |
|---|---|---|
| `190/165` | 1 of 22 | identify it |
| `075/086` | 0 of 2 | fall back to a list |
| `071/131` | 0 of 50 | fall back to a list |

Three for three, where self-report was nought for three. This is not a luckier
threshold — it is a structurally better kind of evidence. A misread number
rarely lands on a real print of the same Pokémon in a set of the same size; a
correct one always does. It is corroboration by an independent source rather
than a model grading its own homework.

**The residual risk, stated plainly:** a misread that happens to be another
real print of the same Pokémon in the same set would be confidently wrong. It
usually fails safe, because prints that share a number (Master Ball and Poké
Ball patterns) match as a group of three rather than singly and so never reach
this branch. The auto-accept floor still applies on top, and still rises to 97
for cards over $100. This is the one place in the scanner where being wrong is
expensive, and it is now resting on three observations — worth revisiting as
the accuracy set grows.

Path B (number and set name agreeing independently) is kept for the day a set
symbol is legible. It has still never fired.

---

## Run 05, 2026-09-03 — the same card, twice, two different answers

| | Scan A | Scan B |
|---|---|---|
| Number read | `190/165` — **exactly right** | nothing |
| Stated certainty | 45% | 0% |
| Model's account | "quite unclear, but I read 190/165" | "severely out of focus and overexposed" |
| Detail available | 44px digits | 44px digits |
| Candidates offered | 22 | 22 |

Same card. Same build. Same 44px of detail. Seconds apart. **The only thing
that differed was the photograph.**

This is the most useful failure in the whole set, because it rules out
everything else. Not resolution — 44px both times. Not the model — same model,
same prompt. Not the matching logic — it never got a number to match. Once
capture resolution stopped being the limit, shot-to-shot variance became the
entire problem.

And a scanner that works on one press and not the next is not a product. A
collector holding a binder of four hundred cards will not accept a coin flip.

### The fix, shipped 2026-09-03 — keep the sharpest of six frames

Pressing Capture now takes six frames over about half a second, scores each one
**on the bottom of the card specifically**, and keeps the sharpest. A photo can
be pin-sharp on the artwork and useless where the small print is, and it is the
small print that decides which of fifty Flareons you own.

The measure is the variance of the Laplacian: run an edge-detecting kernel over
the greyscale image and see how much its output varies. Sharp images have
strong edges in some places and none in others, so variance is high. Blurred
images have weak edges everywhere. **Blown-out images have almost none at all**
— which is why one number catches both of scan B's complaints, out of focus AND
overexposed.

Two things follow that matter beyond focus:

1. **The user is told what actually went wrong.** When the best of six frames
   is still too soft, the app says the bottom of the card never came into
   focus, that glare on foil is the usual cause, and to tilt the card or move
   back. Not "something went wrong" — rule 4.
2. **It is now measurable.** A "Focus where the number is" row reports the
   score of the frame kept and how many were ranked. Scans A and B look
   identical in every existing diagnostic; this is the one that would have told
   them apart.

**The threshold is provisional and marked as such in the code.** It was chosen
to sit under ordinary in-focus text and above a defocused crop, but nothing had
a score until this shipped, so it is calibrated against nothing. It is used
only to word a message to the user — never to reject a scan or change what the
scanner decides — so being wrong about it costs a misleading sentence and
nothing more.

**Costs about half a second per scan.** Against 4.3s end to end, for the
difference between reading the number and not.

**Not verified.** 51 tests pass and the scoring is unit-tested against
synthetic sharp, blurred, flat and blown-out images. Whether six frames of a
real phone camera contain a sharp one can only be found out on a phone.

---

## Run 06, 2026-09-03 — the first clean identification

**Kangaskhan ex, identified outright. No list.**

| | |
|---|---|
| Result | `Kangaskhan ex - 190/165`, SV: Scarlet & Violet 151, $5.58 |
| Confidence | 99%, against a floor of 92 |
| Number read | `190/165` — correct |
| Model's stated certainty about it | 45% |
| Cost | $0.0058 |
| Time | 5.8s |

Both fixes visible in one scan. The number was read, the catalog confirmed
exactly one card carries it, and the scan was accepted — at a stated number
certainty of 45%, which the old gate would have rejected outright and which
happens to be correct.

**Sterling turned the phone flash on.** That is what made this attempt
readable where the previous one was not.

### The flash finding, and why it fits everything else

It is the single highest-value discovery of the session, and it did not come
from the code.

Every failing scan complained of the same two things: **glare and
overexposure**. Both are symptoms of a camera short of light — it holds the
shutter open longer (motion blur from a hand-held card) and raises gain (noise
that swallows small print), while the ambient reflection it is fighting stays
exactly as bright. Adding a constant, close light source lets the shutter get
faster and the gain drop.

It also explains why the same card, in the same build, seconds apart, gave a
perfect read and then nothing. The variance was never random. It was the
camera's exposure decisions changing between presses.

### Shipped 2026-09-03 — a light toggle in the scanner

A "Light on / Light off" button next to Capture, shown **only when the device
actually reports having a torch**. Android Chrome generally does; iOS Safari
generally does not, and a button that silently does nothing is worse than no
button. If the camera refuses the request, the real message is shown rather
than leaving a dead control.

**Default off.** It rests on one observation, and glare on foil is a real risk
in the other direction — a light in the wrong place makes a mirror worse. The
honest thing is to make it easy to try, watch what it does across more cards,
and change the default when there is something to base that on.

### Note on which build this ran

This scan has no "Focus where the number is" row, so it ran **before** the
best-of-six-frames change reached the device. That improvement is still
untested. The flash and the frame selection attack the same problem from
different ends — one adds light, the other picks the best moment — and they
should compound.

---

## Run 07, 2026-09-03 — sharp frame, unreadable number

Kangaskhan ex, light off, best-of-six frame selection live:

| | |
|---|---|
| **Focus where the number is** | **499** (best of 6 frames) |
| Detail where the number is | 44px digits |
| Number read | nothing, 0% certainty |
| Model's account | "too blurry and obstructed by glare and the **Pokémon EX rule box**" |

**499 against a threshold of 40.** The frame was sharp. Frame selection did its
job and the number still could not be read, which settles a question that
mattered: this is no longer a capture problem.

The model's own words point at the cause. The card's bottom is dominated by the
EX rule box — several lines of text — and the collector number is a small part
of it. We were sending that whole width, so most of the pixel budget went to
text nobody needs to read, leaving the digits about **48px** in the image
actually sent.

### The fix, shipped 2026-09-03 — crop to the corners

The full-width bottom strip is replaced by two magnified corner crops, sent
labelled:

| | Full-width strip | Corner crops |
|---|---|---|
| Width of card covered | 100% | 37% |
| Magnification | 1.08x | **2.06x** |
| Digits in the image sent | 48px | **~90px** |
| Tokens | 1,465 | 3,412 (two corners) |

Two corners because placement moved with the era: modern cards print the number
bottom-left, older ones bottom-right. Both are labelled so the model knows
which it is looking at rather than hunting for it. The prompt now also asks it
to give an alternative for any ambiguous digit rather than silently choosing —
it has volunteered exactly that twice unprompted, and it was right to.

The vertical extent is deliberately generous, covering the bottom 28%. A camera
capture is padded so the card's bottom edge sits around 85% down the image,
while an uploaded photo is usually full-bleed with the edge at 100%. A range
tuned to the padded case would miss the number on every uploaded photo — the
path that exists precisely so a scan can be repeated.

**Cost: about $0.0076 a scan, up from $0.0056.** Roughly $7.60 per 1,000.

### Honest note on how much this will help

The one scan that worked had the same 48px digits as several that failed. The
difference was the flash. **Light has done more than magnification so far**, and
this change should be judged against that rather than assumed to be the answer.
It is a real improvement to something measurably wrong, not a prediction that it
is sufficient.

**Not verified.** 51 tests pass, typechecks, builds. No real card has been
through it.

---

## Run 08, 2026-09-03 — identified, and the corner crop is why

**Kangaskhan ex identified outright at 99%.** Second clean identification, and
the first where the number was read confidently.

Set against the scan immediately before it:

| | Run 07 — failed | Run 08 — identified |
|---|---|---|
| Focus where the number is | **499** | **370** |
| Digits in the image sent | 48px | **83px** |
| Number read | nothing, 0% | `190/165` at **85%** |
| Model's account | "too blurry, obstructed by the rule box" | "readable in the bottom-left magnified crop" |
| Time | 5.1s | 3.9s |
| Cost | $0.0056 | $0.0074 |

**The light was OFF for this scan**, confirmed by Sterling. So the corner crop
carried it alone, with nothing else to credit it to.

**The failing scan was the sharper of the two.** 499 against 370, and it was the
blurrier frame that read the number. So sharpness was not the deciding
variable — magnification was. The corner crop is doing the work, and it can be
credited on its own rather than confounded with anything else.

That is worth stating plainly because it corrects the previous entry's caution.
The note in run 07 said light had done more than magnification so far and this
change should not be assumed to be the answer. On this evidence magnification
was the answer, and the caution was misplaced.

The model's account confirms the mechanism directly: *"Collector number 190/165
is readable in the bottom-left magnified crop."* It read it from exactly the
image built for it, and named which of the two corners it used.

### The model's certainty about numbers looks usable again — when the input is

`85%`, the first reading ever above the old 80% floor, and correct. The earlier
pattern (45% correct, 65% and 75% wrong) came from scans where the digits were
never legible in the first place; asked to rate a reading of pixels that did not
contain a number, its answers were noise. Given a legible crop it appears to
know the difference.

**This does not change the gate.** Corroboration by the catalog is still the
better evidence and costs nothing, and one observation is not grounds for
reverting a decision made on three. Recorded because it may matter later.

### Where the scanner now stands

| | |
|---|---|
| Capture | 2160p, best of 6 frames, optional light |
| Digits delivered to the model | 21px → 44px → **83px** |
| Cost | $0.0074 a scan (**~$7.40 / 1,000**) |
| Time | 3.9s |
| Confidently wrong answers, all runs | **zero** |

Still unmeasured: whether this holds across the other five cards, and whether
the light is still needed now that magnification is doing the work.

---

## Glare, named as its own failure — 2026-09-03

Sterling's diagnosis after a session of testing:

> *"If there is glare and it is not clear to see the name, illustration, and
> the number, it is almost impossible for it to catch it."*

Correct, and worth writing down as a limit rather than treating as a bug. If
the printing is not visible to a person, nothing downstream recovers it.

**But the app was giving the wrong advice about it.** Every failed capture said
the card "never came into focus", because sharpness was the only thing being
measured. A frame can be pin-sharp and still be a mirror — run 07 scored **499**
for sharpness and read nothing at all. Telling that user to hold steadier sends
them to do more of what already failed. Glare and blur need opposite responses:
tilt the card, versus hold it closer and steadier.

### Shipped: measure the two separately

`clippedFraction()` reports how much of the number region is blown out to
near-white. Measured on luminance, so coloured foil that clips in one channel
is not mistaken for a reflection.

It does two jobs:

1. **Frame selection is now sharpness x (1 - glare).** Ranking on sharpness
   alone was picking frames that were crisply in focus on a white reflection.
   Glare shifts as the hand moves, so a burst usually contains a better frame —
   but only if the ranking can tell the difference.
2. **The user is told which problem they actually have.** Glare: *"tilt the card
   a few degrees to move the reflection off the number."* Blur: *"hold the card
   so it fills the blue frame — the further away it is, the smaller the number."*

That second message carries the other finding of the session. Sterling: *"I
think I was taking the picture too far away from the frame."* That fits the
whole record — every fix that worked (2160p capture, corner crops) bought back
digit pixels, and filling the frame does the same thing for free. It is the one
lever the user holds in the moment, and the app had never once mentioned it.

Both numbers now appear in the diagnostics panel, so a failure can be
attributed rather than guessed at.

**Thresholds remain provisional** and are used only to choose which sentence to
show. They never reject a scan or change what the scanner decides.

**Not verified against a real glared card.** 56 tests pass, including a
synthetic sharp-mirror frame that scores high for sharpness and is correctly
ranked below a readable one.

---

## The light, made automatic — 2026-09-03

Sterling, testing from a fixed seat under a ceiling light:

> *"From where I'm sitting it's nearly impossible for it to see the number. It
> just needs a light on it so there's no glare... It 100% works when none of
> those things are interrupting the picture."*

That is the correct read of the whole session. **The scanner does not fail
randomly.** It fails when a reflection sits on the one part of the card that
decides which print you own, and it works when nothing is sitting there.

Why a torch beats ambient glare, since it sounds backwards: a reflection is
fixed brightness. Adding light does not make it worse — it raises everything
else to meet it, so the number stops being the dimmest thing under the
brightest spot. The camera can then use a faster shutter and lower gain, which
removes motion blur and noise at the same time.

### Shipped: a second burst under the light, only when glare demands it

Pressing Capture now:

1. Takes six frames and scores each for sharpness and glare.
2. **If glare is covering the number** and the device has a torch, switches it
   on, waits for exposure to settle, and takes six more.
3. **Keeps whichever burst scored better**, then switches the light off.

Two properties worth stating.

**Automatic, not a setting.** None of the above is something a user should have
to know. The manual Light button stays for anyone who wants it.

**Self-correcting, not trusted.** A light on foil can make a mirror worse —
that was the stated reason for leaving the torch off by default, and it was
speculation. Now it does not need to be resolved by argument: both bursts are
scored, and if the lit frames are worse they simply lose. The mechanism cannot
make a scan worse than not having it.

It costs about 0.8s, and only on scans that were failing anyway.

The diagnostics panel reports when the light was used, so its effect can be
read off real scans rather than assumed.

**Not verified.** 56 tests pass, typechecks, builds. Whether a phone torch
actually beats a ceiling light reflection on foil is a question for a phone
under a ceiling light.

---

## Run 09, 2026-09-03 — Flareon, and a third failure mode

| | |
|---|---|
| Number read | `012/102` — wrong (truth `013/131`) |
| **Glare** | **0% blown out** |
| Focus | 176 (readable) |
| Digits sent | 83px |
| Model's account | "extremely blurred and **at a steep angle**" |
| Correct card's rank | **1st of 50** |
| Confidence | 59% — correctly refused |

Neither glare nor size this time. **Perspective.** The card was photographed at
an angle, so the digits are skewed and foreshortened, and no amount of
magnification straightens them. Three distinct failure modes are now on record —
too small, glare, and angle — and they have three different fixes.

The never-guess rule held again: a wrong number matched no candidate, confidence
fell to 59%, and the correct card was offered at the top of the list. **Zero
confidently wrong answers still stands across every run of the session.**

### Flareon can never be identified by its number, however well it is read

Four Prismatic Evolutions Flareons carry `013/131`:

| Print | Price |
|---|---|
| Flareon | $0.33 |
| Flareon (Master Ball Pattern) | **$29.66** |
| Flareon (Poke Ball Pattern) | $2.16 |
| Flareon - 013/131 (Cosmos Holo) | $1.31 |

A perfect read of `013/131` narrows fifty cards to these four and then stops.
**The number is exhausted as a signal**, and the difference between the cheapest
and the dearest is 90x. Any further work on number reading has no effect on this
card, which is a large class: every modern set ships pattern variants.

### Shipped: read the foil pattern

The model is now asked what the holofoil background actually looks like —
repeating Master Balls, repeating Poké Balls, a cosmos starfield, a plain holo,
or unknown — and candidates matching it are ranked first. The catalog already
encodes the answer in its own names ("Flareon (Master Ball Pattern)"), so no new
data source is needed.

Unlike a collector number, a foil pattern is **large, high-contrast and spread
across the whole card**. It is exactly the kind of signal that survives the bad
photograph that destroys a collector number, which is what makes it worth having
rather than merely additional.

**Ranking only, deliberately.** Pattern detection has never been measured
against a real card, and the spread across those four prints is 90x. Ranking a
wrong guess first costs a tap; identifying on one costs a collector real money.
The enum includes `unknown` and the model is told to use it rather than guess.
It can be promoted to an identifying signal when there is evidence it deserves
to be — the same sequence the number signal went through.

**Not verified.** 60 tests pass, typechecks, builds.

---

## Run 10, 2026-09-03 — Flareon, third attempt, and where to stop

| | |
|---|---|
| Number read | nothing, 0% |
| Foil pattern read | **`unknown`** — the model declined to guess |
| Glare | 0% |
| Focus | 135 |
| Time | 14.6s (cold start after deploy) |

The pattern signal returned `unknown`, which is the model doing exactly what it
was told: say so rather than guess, because these prints differ by 90x. Not a
failure of the design — but no help on this card either.

The diagnostics row was hidden when the answer was `unknown`, which made a
declined guess look identical to an undeployed build. Fixed: the row is always
shown now. **A diagnostic that disappears when the answer is inconvenient is
worse than none**, and this file exists because of exactly that class of
mistake.

### Focus scores are drifting down across the session

| Run | 06 | 08 | 09 | 10 |
|---|---|---|---|---|
| Focus where the number is | 499 | 370 | 176 | **135** |

Four scans, monotonically decreasing, all of the same two cards by the same
person in the same room. That is not the app changing. Tiredness, a dimmer
room, a hand less steady late at night — the scanner is being tested under
progressively worse conditions, and results from here are worth less than the
earlier ones. **Stop and re-run these fresh** rather than tuning against them.

### Flareon versus Kangaskhan is the real lesson

| | Kangaskhan ex `190/165` | Flareon `013/131` |
|---|---|---|
| Card type | full-art ultra rare | plain rare |
| Identified outright? | **yes, twice** | no, three attempts |
| Best number read | `190/165` correct at 85% | `012/102`, then nothing |

The full-art card is *easier*, which is the opposite of the intuition that
foils are the hard case. Its number is printed large and clear of the artwork.
The plain rare prints its number small, low-contrast, against a busy
illustration — and there are 50 Flareons and 4 sharing its number.

`docs/PRODUCT.md` says commons and ordinary rares are the bulk of any real
collection. **The cheap cards are the hard ones**, and the scanner should be
judged on Flareon rather than on Kangaskhan.

### Honest state at the end of the session

| | |
|---|---|
| Identifies a full-art card outright | **yes**, repeatably |
| Identifies a plain rare outright | **not yet** |
| Confidently wrong answers, all runs | **zero** |
| Correct card present in the list | **every time** |
| Cost | ~$0.0077 a scan |
| Digits delivered to the model | 21px → 44px → 83px |

Three failure modes are now separated and reported: too small, glare, and
angle. Every one of them tells the user what to change.

### What the next session should do, in order

1. **Re-run the six cards fresh**, in good light, card filling the frame. Half
   of tonight's later data is confounded by a tired tester.
2. **Perspective is the untouched failure mode.** "At a steep angle" appeared
   twice. Nothing in the app corrects for it and nothing tells the user to hold
   the card flat.
3. **Then judge the foil-pattern signal**, which has produced exactly one
   observation and that one was `unknown`.

---

## Run 11, 2026-09-03 — A CONFIDENTLY WRONG ANSWER. Stop-and-fix.

**The first instance of the failure this product cannot afford.**

| | |
|---|---|
| Number read | `088/086` |
| Card displayed | **`Froakie - 056/197 (Cosmos Holo)`** |
| Confidence shown | **99% — "Identified"** |
| Diagnostics claimed | "Number + set agreed on **exactly one card**" |

`088/086` and `056/197` are not the same number. The app asserted certainty
about a card the evidence did not point at, which `docs/ACCURACY-SET.md` has
listed since it was written as outcome 1: *"auto-accepted the wrong card. Any
instance is a stop-and-fix."*

Everything else about the scan was excellent — focus **1718**, the best ever
recorded by a factor of three, 0% glare, and the light retry working. The
capture pipeline did its job perfectly and the logic on top of it threw the
result away.

### Cause: a ranking signal displaced an identifying one

The steps ran in this order:

1. The collector-number step found the one card carrying `088/086` and moved it
   to the front. `numberMatches.length === 1`.
2. The **foil-pattern step**, added an hour earlier, re-sorted the list and
   moved a Cosmos Holo card to the front.
3. `uniquelyResolved` was then computed from the still-true fact that the
   number matched exactly one card — and the caller accepted whatever was at
   position 0.

The verdict was made about one card and applied to another. The pattern signal
was documented as **"RANKING ONLY, and deliberately so"**, with a comment
explaining that identifying on it costs a collector real money. It was ranking
only. It just ran after the thing that identifies, and nothing checked.

### Why it was not caught

This logic lived inside an HTTP route handler and could not be tested. Sixty
tests passed the entire time.

**That is the same root cause as the original single-file build**, recorded at
the top of the test file: the never-guess rule could not be asserted because it
lived inside a function that also drove the camera. The rule was extracted and
tested; the *ranking that decides which card the rule is applied to* was not,
and it moved back into an untestable place as it grew.

### The fix

`lib/scanner/resolve.ts` — the whole pipeline as one pure function, with the
structure enforcing the rule:

> **Weak signals rank. Strong signals identify. Ranking runs FIRST, identifying
> runs LAST**, so nothing can reorder a card out from under a verdict already
> made about it.

Plus a final invariant: if a scan claims to have identified a card, the card at
the front **must** be one the number actually matches. If it is not, the claim
is withdrawn rather than trusted. That check alone would have turned this into
a candidate list.

Six regression tests, including this exact Froakie shape. **66 passing.**

### What this costs, honestly

The session's headline — *zero confidently wrong answers* — is no longer true,
and it was the number that mattered most. It held through every hardware
failure, every misread number and every bad photograph, and was broken by a
feature added to improve ranking.

**A signal that may only rank must be structurally unable to identify.** A
comment saying so is not enough. It was not enough here, and the comment was
mine, written an hour before it failed.

### Confirmed: the read was correct. The bug threw away a right answer.

**Froakie is `088/086`**, verified from the physical card. So:

- The vision model read the number **exactly right**.
- The catalog carries that card — `numberMatches.length === 1` was true because
  a real Froakie `088/086` was sitting in the list.
- The app then displayed a different card.

Nothing about the recognition failed. Capture, magnification, the light retry,
the model, the catalog and the number check all worked, end to end, on a plain
non-holo card at the best focus score ever recorded. **The only thing that
failed was the ordering of my own ranking steps**, and it converted a correct
identification into a confidently wrong one.

With the fix, this exact scan identifies the card.

Worth noting for the same reason as Kangaskhan `190/165`: `088/086` is a secret
rare whose number **exceeds its set total**. Two of the seven cards tested now
have that shape. Any validation asserting numerator <= denominator would reject
both, and both are among the more valuable cards in the set.

---

## Run 12, 2026-09-03 — the fix confirmed on the card that broke it

**`Froakie - 088/086`, ME04: Chaos Rising, Illustration Rare, $7.43. Identified,
99%.**

The proof is one row in the diagnostics:

> **Foil pattern read:** cosmos — 1 candidate match

The pattern signal fired, and pointed at the same Cosmos Holo card as before.
The number check overrode it. **The bug scenario reproduced exactly and was
handled**, which is a far better confirmation than a scan where the conflict
never arose.

What the wrong answer would have cost, concretely:

| | Card shown | Price |
|---|---|---|
| With the bug | Froakie - 056/197 (Cosmos Holo) | $0.76 |
| Correct | Froakie - 088/086, Chaos Rising | **$7.43** |

Wrong card, wrong set, wrong rarity, and a valuation out by ten times. In a
collection of hundreds that is how a portfolio total quietly becomes fiction —
exactly what rules 1 and 2 exist to prevent.

### The model distrusted a correct read, and said why

> *"'088/086' but this appears unusual (first number typically should not
> exceed second in modern sets) — the digits are somewhat obscured."*

It read the number correctly and then talked itself down to 45% certainty
because the format looked wrong to it. It holds the same misconception this
file warned about two entries ago, when Kangaskhan `190/165` came up.

**Fixed in the prompt:** the model is now told that a number exceeding the set
total is normal, that this is how secret rares are numbered, and not to lower
its confidence for it.

Worth noticing that this cost nothing here only because the identifying gate is
catalog corroboration rather than the model's self-report. Had the old 80%
floor still been the gate, a correctly read secret rare would have been
rejected at 45% for looking unusual — and secret rares are the valuable ones.

### Where the session actually ends

| | |
|---|---|
| Cards identified outright | Kangaskhan ex (x2), **Froakie** |
| Numbers read correctly | `190/165`, `088/086` — both secret rares |
| Best focus score | 1297–1718 with three lights |
| Confidently wrong answers | one, found, fixed, and regression-tested |
| Cost | ~$0.0076 a scan |

Still not solved: **plain rares photographed at an angle.** Flareon failed three
times and is the honest measure of the product, since commons and ordinary
rares are the bulk of any real collection.

---

## The app looks like PokAI again — 2026-09-03

The rebuild started deliberately plain so recognition could be worked on without
design noise. That work is far enough along, and looking unfinished is its own
cost: a collector deciding whether to trust an app with their collection reads
the surface before they read the accuracy.

The prototype's identity is carried over rather than reinterpreted — coral
`#E8483A` on near-black `#0A0A0D`, three warm gradient pools, translucent
panels, a 520px phone-width frame, and Space Grotesk / IBM Plex Sans /
JetBrains Mono.

Three things done properly rather than quickly:

- **Fonts are self-hosted** through `next/font` instead of fetched from Google
  on every page load. Same typefaces, one less third-party request, and no
  flash of fallback text.
- **A token that never resolved.** Components referenced `var(--fg)` while the
  stylesheet defined `--text`. Every use of it silently fell back to inherited
  colour. Both names now exist.
- **Rarity stripes on candidate rows.** A fifty-card list is unreadable as fifty
  identical rows; a colour down the edge makes it scannable by shape. The
  colours are the prototype's own tier palette.

**Verified by rendering it**, not by the build passing: the page was loaded in
Chromium and the computed styles checked — body background `rgb(10,10,13)`, the
heading resolving to Space Grotesk, the primary button carrying the coral
gradient.

---

## The camera works on a real phone — 2026-09-03

> *"The picture is perfect, it captures a good frame and scan. The camera is
> working now and does a good job."*

iPhone 17 Pro Max, Safari. The failure was a black preview, and the detail that
solved it was that **the flashlight still turned on**. The torch is applied to
the media track, which never needed the `<video>` element to exist, so a working
torch proved permission was granted and the stream was live. A live stream with
a black preview leaves only one thing broken: the wiring to the element.

The stream was attached inside a `requestAnimationFrame` whose comment claimed
it "waited for React to render the video". It did not wait — it raced. React can
commit after that frame, leaving `videoRef.current` null, the stream unattached
and the element black forever. An effect cannot lose that race.

**Worth keeping as a debugging lesson.** The useful signal was not the failure
but the thing that still worked next to it. Torch on, picture black, was worth
more than any amount of reasoning about CSS.

Three iOS-specific hardenings shipped alongside: `muted` set as a property
rather than trusting React to reflect it (Safari refuses inline playback of
anything it deems unmuted), `playsinline` forced as an attribute, and `autoPlay`
so the element can start itself if a scripted `play()` is refused.

---

## Run 13, 2026-09-03 — the full set, and the first real pass

**Five of five English cards identified outright. The Japanese card correctly
found no match.**

| # | Card | Result |
|---|---|---|
| 1 | Mega Pyroar ex `015/086` | identified |
| 2 | Goldeen | identified |
| 3 | Flareon `013/131` | identified |
| 4 | Dipplin `010/131` | identified |
| 5 | Mega Greninja ex (JAPANESE) | **no match — correct** |
| 6 | Kangaskhan ex `190/165` | identified |

Sterling: *"they all got the exact reading, it was not the list."*

**Card 5 is the result worth dwelling on.** The catalog is TCGPlayer-sourced and
English-only, so there was no correct answer for that card to find. The only
outcomes available were "no match" and a confident match to an English print
with similar artwork — which would carry a completely wrong valuation, since
Japanese prints are priced independently. It declined. That is rule 1 working
on the one card in the set designed to break it, and it is a better result than
the five successes.

For comparison, the same card in run 01 was misread as *"Kyogre-ex"* at 75%
confidence. It still found nothing, so no harm was done either time, but the
failure has moved earlier and cleaner.

### The distance travelled today

| | This morning | Now |
|---|---|---|
| Cards identified outright | 0 | **5 of 5** |
| Digits reaching the model | 21px | 83px |
| Camera | 1080p, black preview on iOS | 2160p, best of 6 frames, working |
| Cost | — | ~$0.0076 a scan |

### One loose end I cannot explain from the code

**Flareon identifying outright should not be possible as I understand the
logic.** Four prints carry `013/131` — plain $0.33, Master Ball $29.66, Poké
Ball $2.16, Cosmos Holo $1.31 — so a correct number read matches four
candidates, not one, and `resolveCandidates()` should refuse to identify and
offer the group.

Three explanations, and I do not know which:

1. The search returned fewer candidates this time, leaving the number unique.
2. The foil-pattern signal is doing more than ranking — **which is the bug
   fixed today**, and would mean the fix is incomplete.
3. It identified through `isClearlyBest` on a name-score gap I have not
   accounted for.

Explanation 2 is the one that matters: it would mean a $0.33 card can still be
named when a $29.66 one is equally consistent with the evidence. **Not treated
as settled.** The next session should scan Flareon once and read its
diagnostics panel — specifically "Cards found in database" and "Foil pattern
read".

A pass on the accuracy set is a real milestone. It is not the same as
understanding why every card passed, and this file has already recorded one
confidently wrong answer that 60 passing tests did not catch.
