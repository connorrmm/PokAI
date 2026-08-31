# Architecture — the plan to production

Written 2026-08-31. This is a decision document. Where it commits to something,
the reasoning is stated so it can be argued with.

Context that shaped it: the backend was never a real codebase. All prior work
happened in chat sessions and was pasted into a single HTML file. So there is no
legacy server to migrate — this is a clean first build, and it should be boring
and cheap to run.

## The stack

| Layer | Choice | Cost to start |
|---|---|---|
| Front end | The existing single-file app, deployed to **Netlify** | $0 |
| Backend API | **Netlify Functions** (serverless, same project) | $0 |
| Database + auth + file storage | **Supabase** (hosted Postgres) | $0 |
| Card data + prices | **tcgapi.dev** | $0 dev / $49.99 mo commercial |
| Card recognition | **Claude Haiku 4.5** vision, server-side | ~$2.50 per 1,000 scans |

### Why this and not something else

**Netlify Functions rather than a separate server.** Sterling already has
Netlify. Putting the API in the same project means one account, one deploy, one
place secrets live, and no second hosting bill. The backend PokAI needs is a thin
one — proxy the card API, hold the recognition key, talk to the database — which
is exactly what serverless is good at. If we later need long-running jobs this
becomes limiting, and at that point we move the API to a real server. That's a
later problem, not a now problem.

**Supabase rather than rolling our own.** It is Postgres, plus user accounts,
plus file storage, on one free tier. Accounts are the part worth not building
by hand — password handling and session security are easy to get subtly wrong,
and getting them wrong is the kind of failure that ends a product. Free tier
covers us to real usage; $25/mo after that.

**One rule the whole design hangs on: the app never calls a third party
directly.** The browser talks only to our API. Our API talks to tcgapi.dev and
to Claude. This is what keeps paid keys out of a public repo, and it means
swapping a data provider later is a backend change nobody using the app notices.

## How card data stays fresh

Sterling's requirement: *the cards need to update repeatedly.*

Doing that by calling tcgapi.dev on every scan would be wrong — it makes every
scan depend on someone else's uptime, and it burns the daily request quota on
repeated lookups of the same card.

Instead, **we hold our own copy and refresh it on a schedule:**

```
tcgapi.dev  --(nightly scheduled job)-->  our Supabase database  -->  the app
```

- A **nightly job** pulls updated prices into our database.
- A **weekly job** pulls new sets and cards, so new releases appear without a
  code change.
- The app reads only from our database, so a scan is fast and works even when
  tcgapi.dev is down.
- Every stored price carries **its source and the timestamp it was fetched.**
  The app displays both.

That last point is not decoration. Product rule 2 is never fabricate a price,
and `docs/PRODUCT.md` requires market transparency — where a price came from and
when it was updated. Storing the timestamp is what makes honest display
possible: when data is stale or missing, the app can say so instead of guessing.

## Recognition — what changes

**Today there is no AI vision model in the scanner.** It uses Tesseract.js, a
traditional OCR engine that matches letter shapes. It is not AI and does not
understand what it is looking at. It reads a strip of the image and returns its
best guess at the text, which is why it struggles with foil glare, stylised
fonts, and holo cards — the exact cards that matter most.

**The plan: a real vision model reads the card, server-side.**

```
photo -> our API -> Claude Haiku 4.5 reads the card
                 -> returns name, number, set, rarity as structured data
                 -> matched against our card database
                 -> confidence score
                 -> auto-accept, or show every candidate
```

The model replaces the *reading* step only. Everything downstream — matching,
confidence, thresholds, the never-guess rule — stays. That existing logic is
sound; it was being fed bad text.

Why Haiku 4.5: it is the cheapest current model that can read images, and card
reading is a well-defined extraction task, not a reasoning problem. If accuracy
testing shows it missing cards a larger model catches, moving up to Claude
Sonnet 5 is a one-line change at roughly twice the cost. **That decision should
be made from measured accuracy, not guessed at now.**

Tesseract stays initially as an offline fallback, and gets removed once the
vision path is proven. Two recognition paths is complexity we only want while
we still need it.

### What a scan will cost

Rough estimate, to be measured before committing: a card photo plus prompt is on
the order of 1,500–2,000 input tokens, with a short structured response out.

| Model | Input / output per 1M | Estimated per 1,000 scans |
|---|---|---|
| Claude Haiku 4.5 | $1 / $5 | **~$2.50** |
| Claude Sonnet 5 | $2 / $10 | ~$5 |

**This is not a real estimate until it is measured.** The exact number depends on
what resolution we send, and I will measure it with the token-counting endpoint
before anyone signs up for anything. Directionally, though, scanning is cheap:
even at ten thousand scans a month, this is a small bill.

## Security

- **Every paid key lives server-side only.** The repository is public. A key in
  the front end is a key published to the world.
- Keys are stored as environment variables in Netlify, never committed.
- Our API rate-limits by user, so one account cannot burn the whole quota.
- Supabase row-level security: a user can read and write only their own
  collection. This is configuration, and it must be verified rather than
  assumed — it is the difference between private collections and public ones.

## Database — first cut

```
cards          the catalog, synced from tcgapi.dev
                 id, name, set, number, rarity, image_url
prices         price per card, with source + fetched_at   <- transparency rule
users          handled by Supabase Auth
collections    which user owns which card, condition, when scanned
scans          scan history: photo, what was read, what was chosen
corrections    when a user fixes a wrong identification    <- training signal
```

`corrections` exists because `docs/PRODUCT.md` calls continuous improvement a
core value: a user fixing a misidentification is data about which cards the
scanner confuses. It costs almost nothing to capture now and cannot be recovered
later if we don't.

## What is deliberately not being built

Trading, marketplace, social feeds, deck building — out of scope per
`docs/PRODUCT.md`. Native mobile apps: the web app works on a phone, and the
camera works over HTTPS. Revisit only if the web version proves limiting.
