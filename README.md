# PokAI

Pokémon card scanning and collection platform. Point a phone at a card, know
exactly which card it is, what it's worth, and track it in a collection.

**SCAN → KNOW → TRACK → GROW**

## Status

Early prototype. Nothing is deployed with a working backend, and nothing saves
between page loads.

**Read [`docs/STATUS.md`](docs/STATUS.md) before trusting anything else in this
repository.** It is verified against the actual code and says plainly what was
checked, what wasn't, and why.

## What's here

```
index.html                        the prototype — the whole app, one file
prototype/pokai-app-bundled.html  a NEWER build than index.html (see STATUS.md §2)
CLAUDE.md                         project rules and context for Claude Code
docs/STATUS.md                    what actually exists — start here
docs/PRODUCT.md                   vision, MVP scope, the "never guess" rule
docs/SCANNER.md                   recognition pipeline findings
docs/CATALOG.md                   card database strategy
docs/OPEN-QUESTIONS.md            decisions still to be made
docs/MODEL-POLICY.md              which AI model to use for which work
.claude/agents/                   Sonnet-pinned helper agents
```

## Running it

No build step, no dependencies to install. Serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Do not open `index.html` as a `file://` URL — the camera needs HTTPS or
localhost, and OCR will not start.

Card lookups will fail until a backend exists at `http://localhost:3001`; the app
falls back to a 22-card offline pool. That's expected, not a bug in the page.

## Two things to know before changing anything

1. **The committed `index.html` is an older build** than
   `prototype/pokai-app-bundled.html`. Reconcile them before building on either.
2. **The committed build violates the project's number-one product rule** by
   showing no candidate list on a low-confidence scan. Details in
   `docs/STATUS.md` §2.
