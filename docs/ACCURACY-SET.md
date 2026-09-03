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
