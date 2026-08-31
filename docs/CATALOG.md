# Card data

## Data source

Verified 2026-08-31: the committed `index.html` does **not** call
`api.pokemontcg.io` directly. It calls its own backend
(`http://localhost:3001/api/search`, line 1688), which was meant to proxy that
API and hold any paid key server-side. That backend is not in this repository —
see `docs/STATUS.md` section 2 — so **every card lookup in the committed app
currently fails**, and the app falls back to its 22-card offline pool. I observed
this directly: all lookups returned `ERR_CONNECTION_REFUSED`.

The proxy design itself is correct and worth keeping. It is the reason no API key
sits in the public client, and it is what makes swapping in a paid provider a
backend-only change.

The prototype was designed against the free Pokémon TCG API (`api.pokemontcg.io/v2`). Relevant
verified facts:

- Max page size is 250 records per request.
- No API key required, but a free key raises rate limits meaningfully.
- Card records carry stable IDs (`base1-4`), set info, card number, rarity, and
  image URLs — enough to build a scanner catalog directly.
- **Measured reliability is poor**: roughly 41% reliability / 59% error rate,
  ~8s average response time over a recent 30-day window, per a public API
  monitor. This is the single strongest argument for not calling it live on the
  user's critical path.

The service has since been folded into a broader commercial TCG toolkit, so its
long-term free availability is uncertain. Worth checking current terms before
building hard against it. Paid alternatives exist and may be worth it.

## Strategy: master catalog → enabled subset → scanner

Rather than calling a third-party API on every scan, the plan is to hold card
data locally and enable a curated subset for scanning:

```
MASTER CATALOG (everything, 20k–30k+ cards)
        ↓  priority scoring
ENABLED SUBSET (~10,000 to start)
        ↓
     SCANNER
```

Growing from 10,000 to 15,000 supported cards should be a config change and a
re-run, never an app rebuild. Whether "enabled" is a column, a view, or
something else is your call.

Why a curated subset rather than everything: it keeps the matching space smaller
and the highest-value cards best-covered, while leaving room to expand. If you
think loading the full catalog is simpler and performs fine, that's a reasonable
counter-argument — make the case.

## Priority ordering

The first 10,000 should be weighted toward what people actually scan, not
chosen chronologically or at random. Rough priority:

1. High-value chase cards
2. Popular Pokémon (Charizard, Pikachu, Umbreon, Eevee, Mewtwo, Rayquaza, Lugia…)
3. Vintage sets — Base Set, Jungle, Fossil, Team Rocket, Gym, Neo, e-Card, EX era
4. Current Scarlet & Violet era, which is what people are actively opening
5. Promos
6. Special illustration and secret rares
7. Normal rares
8. Commons and uncommons

Signals worth scoring on: set importance, rarity tier, whether the name is a
popular Pokémon, promo status, and secret-numbered cards (where the card number
exceeds the set total, e.g. `196/131` — these are almost always the chase card).

**Include priority sets complete.** "All of Base Set" beats "the highest-scoring
10,000 cards individually," because a collector flipping through one binder
should get every card in it recognized. A pure global sort will silently drop a
set's commons.

## A real bug worth knowing about

A hand-maintained list of priority set names had all 16 EX-era sets keyed with an
`"EX "` prefix — `"EX Legend Maker"`, `"EX Delta Species"`. **The API returns
those set names without the prefix** (`"Legend Maker"`). Every one of them
silently fell through to a default priority instead of their intended high
priority. It was caught only by chance, against a 32-card sample.

Two lessons:
1. Never hand-maintain a list of external identifiers without validating it
   against the real source. Fetch the real set list and diff against it.
2. This bug class is silent — nothing errors, results are just quietly wrong.
   Prefer designs where a mismatch fails loudly.

Also unverified and worth checking: the set commonly called "151" may be named
`"Scarlet & Violet 151"` in the API. Still **not confirmed against the API** as
of 2026-08-31 — I could not reach it from this environment. Note only that the
prototype's own hardcoded pool uses the string `'Scarlet & Violet 151'`
(`index.html` line 770). That is what a human typed into a demo array, not
evidence about what the API returns. Check it against the real set list before
relying on it — this is exactly the bug class described above.
