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
