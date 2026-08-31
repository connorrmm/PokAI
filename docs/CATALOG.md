# Card data

## Provider decision (2026-08-31)

**Chosen: tcgapi.dev.** Sterling identified it as the live API for this project.
It covers Pokémon card data and daily market values, authenticates with an
`X-API-Key` header, and exposes cards, sets/expansions, and pricing endpoints.

Plans, as published: Free 100 requests/day, Hobby $9.99 (1K/day), Starter $19.99
(2.5K/day), Pro $49.99 (10K/day), Business $99.99 (50K/day). **Free, Hobby and
Starter are licensed for personal and non-commercial use only — commercial use
starts at Pro.** PokAI is commercial, so Pro is the floor for launch. Build and
test on Free.

**Not verified by me.** tcgapi.dev is blocked by this environment's network
egress policy; I could not reach it. Everything above comes from their public
pages via web search, not from calling the API. Treat it as good-faith secondhand
information until a key exists and the endpoints are confirmed to return what we
need. That confirmation is the first task of Phase 1 in `docs/ROADMAP.md`.

This replaces the earlier plan to use the free `api.pokemontcg.io`, whose
measured ~41% reliability is documented below and is the reason we cache locally
regardless of provider.

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
long-term free availability is uncertain. This is part of why the project moved
to tcgapi.dev — see the provider decision at the top of this file. The rest of
this section is retained as historical context for how the prototype worked, not
as a live plan.

## Freshness — how "the cards update repeatedly" works

Sterling's requirement is that card data updates on its own. The design is in
`docs/ARCHITECTURE.md`; the rule that matters here:

**We never call the provider on the scan path.** A nightly job refreshes prices
into our own database and a weekly job pulls new sets and cards. The app reads
only our copy.

Three reasons, all learned the hard way and all still true with a paid provider:
a scan stops depending on someone else's uptime; the daily request quota isn't
burned re-fetching the same card; and new sets appear without a code change.

Every stored price carries **its source and the timestamp it was fetched**, which
is what makes product rule 2 — never fabricate a price — actually enforceable.
When data is missing or stale, the app can say so precisely instead of showing a
number that looks current.

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
