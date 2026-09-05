# What Sterling needs to do

Written 2026-08-31. This is the complete list of things that need a human with
account access. Nothing here needs technical knowledge; each item says what it
is, what it costs, and why it's needed.

Work top to bottom — items 1–4 unblock everything else.

---

## 1. Vercel — **connected, but no project yet**

Sterling connected Vercel on 2026-08-31 (switching from the earlier Netlify
plan). Account: `longsterling61-4597's projects`, on the **Hobby** plan.

**Still to do — and it needs the dashboard, not me.** Creating the project
through Vercel's API fails in a way I cannot work around: it reports success,
returns a project id, and the project is then unreadable (404) and absent from
the project list. Tried twice under two names, same result each time.

Do this by hand instead, about a minute:

1. Go to **vercel.com/dashboard**.
2. If a **`pokai`** or **`pokai-app`** project is listed, delete it — those are
   half-created leftovers from the failed API attempts.
3. **Add New → Project → Import Git Repository →** pick `connorrmm/PokAI`.
4. Framework Preset: **Next.js**. Leave the build and output settings on their
   defaults.

   **Correction, 2026-08-31:** this step previously said to choose "Other" with
   a blank build command. That was right when the repo was a single HTML file
   and became wrong the moment the Next.js rebuild merged — with "Other" saved,
   Vercel serves files without building, so the API routes do not exist and,
   since `index.html` moved into `public/`, the site 404s entirely.
   `vercel.json` now pins `"framework": "nextjs"`, which overrides the dashboard
   setting, so a project created either way builds correctly.
5. Deploy, then send me the URL.

The never-guess defect that previously made deploying a bad idea is now fixed,
so the deployed app will be honest.

**Before launch you must upgrade to Vercel Pro, $20/month.** The free Hobby plan
is licensed for non-commercial personal use only, and PokAI is commercial. Not
needed while building.

*Why:* the camera only works over HTTPS. Opening the file locally will never
allow scanning.

---

## 2. Create a Supabase account — **free**

Sign up at supabase.com, create a project, and pick a region near your users.
Save the database password somewhere safe.

You'll get a project URL and two keys. **Send me the URL and the key labelled
`anon`. Do not send the one labelled `service_role`** — that one is a master key
and it goes straight into Vercel's settings, not into a chat message.

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

**Send me nothing.** This key goes directly into Vercel's environment settings.

*Why:* this is the AI that actually reads the card. There is no AI vision model
in the app today — it uses old-fashioned text recognition, which is why holo and
foil cards read badly.

*Cost:* you pay per scan, not monthly. My estimate is about $2.50 per thousand
scans, which I'll confirm by measurement before we turn it on.

---

## Where keys go

Anything paid or powerful goes into **Vercel → Project Settings → Environment Variables**, never into the code. This repo is public — anything committed to it
can be read by anyone.

Safe to send me in chat: the Vercel URL, the Supabase project URL, the Supabase
`anon` key.

**Never send in chat:** the Supabase `service_role` key, the tcgapi.dev key, the
Anthropic key. Put those in Vercel directly.

**This already happened once.** On 2026-08-31 the Anthropic and tcgapi.dev keys
were pasted into chat. Sterling judged the risk acceptable and chose not to
rotate them. Recording it here so the decision is visible rather than forgotten,
and so that if either key ever behaves oddly, this is the first thing to check.
Neither key was ever written to this repository.

---

## Questions only Sterling can answer

1. ~~Is anything already live?~~ **ANSWERED** — no. The Vercel account has zero
   projects, and GitHub Pages is off. Nothing is deployed anywhere.
2. **What does "condition tracking" mean?** It's listed as MVP but never defined.
   Does the user pick a grade from a list? Do we assess it from the photo? Do we
   integrate with a grading service? The first is a day's work; the last is a
   different product. I need to know which one you meant.
3. **Has anyone looked at the legal side?** Card art is owned by The Pokémon
   Company, and displaying it in a paid product is a real question. So is
   redistributing market prices. Neither blocks building, both should be answered
   before charging money. Flagging, not solving — this needs a lawyer, not me.

---

## Collections — what Sterling must do (2026-09-04)

Signing in and saving cards is built but **cannot work until two things are
set**. Both are in Sterling's hands, not in the code.

### 1. One new environment variable in Vercel

`NEXT_PUBLIC_SUPABASE_ANON_KEY`

Supabase dashboard → Project Settings → API → the key labelled **anon /
public**. Add it in Vercel → Settings → Environment Variables for all three
environments, then redeploy.

**This key is public by design** — it ships in the browser and is meant to.
Safety comes from row-level security, which is why those policies were tested
three times. It is NOT the `service_role` key, which bypasses RLS entirely and
must never appear in client code.

`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already set.
`/api/health` now lists all three and says what each is for.

### 2. Allow the sign-in link to come back to the site

Supabase dashboard → Authentication → URL Configuration:

- **Site URL:** `https://pok-ai-drab.vercel.app`
- **Redirect URLs:** add `https://pok-ai-drab.vercel.app/**`

Without this Supabase refuses to send people back after they click the email
link, and sign-in fails at the last step with an unhelpful error.

### Worth knowing about the email

Supabase's built-in email sender is **rate-limited to a handful of messages an
hour** and is for testing only. Fine for the two of us; it will not survive
real users. Before launch this needs a real sending service (Resend, Postmark
or similar) configured under Authentication → Emails. That is a paid service at
volume, so it is a decision for later, not a purchase to make now.

---

## One switch to flip: anonymous sign-ins (2026-09-04)

The app now creates an account by itself the first time someone opens it, so
the portfolio is simply there — no email, no password, nothing to do before
seeing your collection. It is a real account with real row-level security; it
just has no email attached yet, and adding one later keeps the same collection.

**This needs one setting turned on**, and until it is, the portfolio falls back
to asking for an email:

> Supabase dashboard → **Authentication** → **Sign In / Providers** →
> **Anonymous sign-ins** → enable

If it is off, the app says so in its own words rather than failing silently —
the error names the setting.

**Why anonymous rather than storing collections in the browser:** browser
storage is wiped by clearing site data, private browsing, or switching phones.
A collection that can evaporate is worse than one that needs an account.

---

## CAPTCHA on anonymous sign-ins — the remaining abuse gap

**Why.** The app creates an account for anyone who opens it, and each account
may run 300 scans a day (migration 0008). That cap bounds ONE account. Nothing
bounds how many a script can create, and every new one gets its own 300 — so
the total spend is unbounded until this is closed. Supabase says as much on the
anonymous sign-ins screen.

**Cloudflare Turnstile**, chosen over hCaptcha: free with no volume cap, and it
passes silently in most cases where hCaptcha shows a puzzle. The check runs at
the exact moment the app was designed to have no friction, so invisible is the
requirement rather than a preference.

**The app code is already written and shipped.** It is inert until configured —
with no sitekey it resolves to nothing and sign-in behaves exactly as it does
today. Nothing breaks if this is never done, and nothing needs coordinating.

Three steps, in this order:

1. **cloudflare.com → Turnstile → Add site.** Domain `pok-ai-drab.vercel.app`.
   Widget mode **Managed**. It gives a **site key** (public) and a **secret
   key** (private).
2. **The site key → Vercel** as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, all three
   environments, then redeploy. Public by design; it ships in the browser.
3. **The secret key → Supabase** → Authentication → Attack Protection → enable
   CAPTCHA, provider Turnstile, paste the secret. **Straight from Cloudflare to
   Supabase — never through a chat, a file, or this repository.**

Order matters. Enabling it in Supabase first, before the sitekey is deployed,
means every sign-in is rejected for a missing token and the app stops working
for everyone.

`/api/health` reports whether the site key is set.

**If Turnstile is unreachable or times out**, the app continues without a token
rather than stranding anyone on a blank screen. Supabase then rejects that
sign-in with a message naming the reason, which is recoverable; an app that
silently never loads is not.
