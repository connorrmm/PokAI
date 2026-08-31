# Card data

## Provider decision (2026-08-31)

**Chosen: tcgapi.dev.** Sterling identified it as the live API for this project.
It covers Pokémon card data and daily market values, authenticates with an
`X-API-Key` header, and exposes cards, sets/expansions, and pricing endpoints.

**Plans — VERIFIED 2026-08-31** from the vendor's own page (their pricing table
is emitted in the page source, so this is their data, not a summary of it):

| Tier | Price/mo | Requests/day | Commercial use |
|---|---|---|---|
| Free | $0 | 100 | **no** |
| Hobby | $9.99 | 1,000 | **no** |
| Starter | $19.99 | 2,500 | **no** |
| **Pro** | **$49.99** | **10,000** | **yes** |
| Business | $99.99 | 50,000 | yes |

PokAI is commercial, so **Pro is the floor for launch.** Build and test on Free.

There is also an x402 pay-per-request option (USDC on Base or Solana, no
account): ~$0.005 per search or card lookup, $0.05 bulk, $0.25 export. Noted for
completeness; a monthly plan is simpler and avoids putting crypto in the payment
path.

**Still unread: the data licensing terms.** Their docs list a licensing page
covering "commercial use, caching, derived data, attribution, redistribution
boundary." The caching and redistribution clauses bear directly on the design in
`docs/ARCHITECTURE.md`, which copies their catalog into our database. **Read
before the sync job is written.**

**Endpoint correction, 2026-08-31.** The API base is **`https://api.tcgapi.dev/v1`**
— an `api.` subdomain. Requests to `https://tcgapi.dev/v1/...` return **404 on
every path**, which Sterling confirmed by running them from his own machine.
Notably they return 404 rather than 401, meaning the key is never even checked;
the paths simply do not exist there.

**CONFIRMED WORKING 2026-08-31** — a real call returned HTTP 200 with live data:

```
curl "https://api.tcgapi.dev/v1/search?q=charizard&game=pokemon&limit=2" \
  -H "X-API-Key: YOUR_API_KEY"
```

Endpoints known to exist:

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /v1/search?q=&game=&limit=` | key | cross-game card + sealed search — **verified 200** |
| `GET /v1/games` | none | 54 games, with card counts — **verified 200** |
| `GET /v1/games/{slug}/sets` | none | sets per game |
| `GET /v1/cards/{id}` | key | card detail, per-condition prices, history |
| `GET /v1/bulk/...` | key | bulk prices and resolve-by-name |
| `GET /v1/x402/info` | none | live pay-per-request price map |

`GET /v1/cards?q=...` returns **404** — the cards endpoint is by id, not a query.
Search is the query endpoint.

Authoritative machine-readable spec: `https://tcgapi.dev/openapi.yaml`, with a
full LLM-oriented reference at `https://tcgapi.dev/llms-full.txt`.

**Data freshness, per their own description:** prices refresh **daily** for the
major games including Pokémon, and catalog-wide every 3 days. Pricing is sourced
from **TCGPlayer**. A nightly sync therefore matches their update cadence
exactly — running it more often would spend quota for no new data.

### Verified response shape

```json
{ "id": 21939, "name": "Charizard", "clean_name": "charizard",
  "number": "025/185", "rarity": "Rare", "tcgplayer_id": 226395,
  "product_type": "Cards", "foil_only": 0, "total_listings": 354,
  "game_name": "Pokemon", "game_slug": "pokemon",
  "set_name": "SWSH04: Vivid Voltage", "printing": "Normal",
  "market_price": 3.68, "low_price": 0.96, "median_price": 4.2,
  "lowest_with_shipping": 1.34,
  "price_updated_at": "2026-08-31T07:18:27.028Z",
  "image_url": "https://product-images.tcgplayer.com/fit-in/400x400/226395.jpg" }
```

Two things this settles. **`price_updated_at` is supplied by the provider** —
that is when the price was true, which is a different fact from when we fetched
it, and the schema now stores both. And **card images are hosted by TCGPlayer**,
not by us, which is relevant to the copyright question in
`docs/OPEN-QUESTIONS.md`: we would be linking their images rather than storing
Pokémon artwork ourselves.

Conventions worth knowing: pagination is `page` / `per_page` / `has_more` with
`per_page` capped at 200; errors come back as `{error:{message,code}}`; rate
limit state is in `X-RateLimit-*` response headers.

Caution learned here: search results mix up at least three similarly named
services — **tcgapi.dev**, tcgapis.com and tcgapi.net. Earlier notes in this
file may have blended their details. Trust only what a real call returns.

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
