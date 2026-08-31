# What Sterling needs to do

Written 2026-08-31. This is the complete list of things that need a human with
account access. Nothing here needs technical knowledge; each item says what it
is, what it costs, and why it's needed.

Work top to bottom — items 1–4 unblock everything else.

---

## 1. Connect Netlify to the GitHub repo — **free, ~5 minutes**

Sterling has a Netlify account but it isn't connected to this repo.

In Netlify: **Add new site → Import an existing project → GitHub →** pick
`connorrmm/PokAI`. There's no build command and no build directory — it's a
plain HTML file, so leave those blank.

**Then send me the URL it gives you.** I need it to confirm what's actually live.

*Why:* the camera only works over HTTPS. Opening the file locally will never
allow scanning. This also gets us a real link to share.

---

## 2. Create a Supabase account — **free**

Sign up at supabase.com, create a project, and pick a region near your users.
Save the database password somewhere safe.

You'll get a project URL and two keys. **Send me the URL and the key labelled
`anon`. Do not send the one labelled `service_role`** — that one is a master key
and it goes straight into Netlify's settings, not into a chat message.

*Why:* this is the database. It's what makes collections survive closing the
app, and it handles logins.

*Cost:* free tier is genuinely enough to launch. $25/mo later, at real scale.

---

## 3. Get a tcgapi.dev API key — **free to start, $49.99/mo to launch**

Sign up at tcgapi.dev and create an API key. **Start on the free tier** — 100
requests a day, no card required. That's enough for me to build and test against.

**Before launching to real users you must upgrade to the Pro plan at $49.99/mo.**
Their Free, Hobby and Starter tiers are licensed for personal and non-commercial
use only. PokAI is a commercial product, so Pro is the cheapest tier that
legally permits it. It also raises the limit to 10,000 requests a day.

**I am not asking you to pay for this yet.** Free tier first, upgrade when we're
close to launch.

*Why:* this is where real card names, sets, numbers, rarities and market prices
come from. It's what makes "never invent card data" and "never fabricate a
price" possible.

*Caveat, stated plainly:* my sandbox blocks tcgapi.dev, so I could not test it
myself. Everything I know about their plans and limits comes from their public
pages via search, not from calling the API. **The first thing I'll do with a key
is verify it actually returns what we need before we build on it.** If it
doesn't, I'll tell you and we'll pick a different provider.

---

## 4. Get an Anthropic API key — **pay per use, ~$2.50 per 1,000 scans**

Sign up at console.anthropic.com, add a payment method, and create an API key.
Set a monthly spend limit — start at $20 so it cannot surprise you.

**Send me nothing.** This key goes directly into Netlify's environment settings.

*Why:* this is the AI that actually reads the card. There is no AI vision model
in the app today — it uses old-fashioned text recognition, which is why holo and
foil cards read badly.

*Cost:* you pay per scan, not monthly. My estimate is about $2.50 per thousand
scans, which I'll confirm by measurement before we turn it on.

---

## Where keys go

Anything paid or powerful goes into **Netlify → Site settings → Environment
variables**, never into the code. This repo is public — anything committed to it
can be read by anyone.

Safe to send me in chat: the Netlify URL, the Supabase project URL, the Supabase
`anon` key.

**Never send in chat:** the Supabase `service_role` key, the tcgapi.dev key, the
Anthropic key. Put those in Netlify directly. If one is ever pasted somewhere it
shouldn't be, say so and we rotate it — that's a five-minute fix, and it is much
cheaper than the alternative.

---

## Questions only Sterling can answer

1. **Is anything already live on Netlify?** If so I need the URL. If a site is up
   today, its card lookups are broken — it's calling an address that only exists
   on a developer's own laptop.
2. **What does "condition tracking" mean?** It's listed as MVP but never defined.
   Does the user pick a grade from a list? Do we assess it from the photo? Do we
   integrate with a grading service? The first is a day's work; the last is a
   different product. I need to know which one you meant.
3. **Has anyone looked at the legal side?** Card art is owned by The Pokémon
   Company, and displaying it in a paid product is a real question. So is
   redistributing market prices. Neither blocks building, both should be answered
   before charging money. Flagging, not solving — this needs a lawyer, not me.
