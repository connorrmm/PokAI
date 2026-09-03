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
