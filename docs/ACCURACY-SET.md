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

Read from the reference photo. Entries marked *uncertain* were not fully legible
and should be corrected by whoever owns the cards.

| # | Card | Number | Set | Why it is in the set |
|---|---|---|---|---|
| 1 | Mega Pyroar ex | 015/086 | Mega Evolution era | Full art, heavy foil, large HP |
| 2 | Goldeen | 118/165 | SV: 151 | Plain common — the boring case that must not break |
| 3 | Flareon | 017/131 | Prismatic Evolutions | Stage 1, ordinary rare |
| 4 | Dipplin | 010/131 *uncertain* | Prismatic Evolutions | Uncommon, busy artwork |
| 5 | **Mega Greninja ex** | — | **JAPANESE** | The hard case. See below. |
| 6 | Kangaskhan ex | 040/A063 *uncertain* | Mega Evolution | Unusual `A`-prefixed numbering |

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

**Card 6 (Kangaskhan ex)** — the `040/A063` format does not match the usual
`NNN/NNN` shape. `extractCardNumber()` uses `/(\d{1,4})\s*\/\s*(\d{1,4})/`,
which will not match a letter prefix in the denominator. **Predicted failure of
the number signal**, meaning this card should fall back to a candidate list
rather than being identified outright.

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
