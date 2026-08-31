# Product

## What PokAI is

An operating system for a Pokémon card collection. The loop is:

**SCAN → KNOW → TRACK → GROW**

Point a phone at a card. Know exactly which card it is — not just "a Charizard,"
but which print, which set, which variant. See what it's worth. Watch the
collection's value over time.

Business goal: scale to a $50M+ company by end of 2027.

## Who it's for

Collectors with physical cards — from someone with a shoebox of childhood cards
to someone managing a graded, insured collection. The person scanning an old
binder is the user to impress first: if PokAI nails a 1999 Base Set card
instantly, that person tells other collectors.

## The "Never Guess" principle

This is the product's defining behavior, and it drives most of the recognition
design.

When the scanner is confident, it accepts automatically and the experience feels
magical. When it is not confident, it shows **every card matching that name** and
lets the user pick. It never truncates that list, and it never presents a
low-confidence guess as an answer.

The reasoning: a collector who is shown the wrong card and doesn't notice ends up
with a corrupted collection and a wrong valuation. That is a far worse outcome
than being asked to tap the right one. Being asked feels like a careful tool.
Being wrong feels like a broken one.

A dead-end error is also unacceptable. "Couldn't read that card" with no options
is a failure. Showing candidates is always better than showing nothing.

**The committed app currently breaks this rule.** On a low-confidence read it
shows exactly the dead end described above, and on an ambiguous read it truncates
the candidate list to 8. Verified 2026-08-31 at `index.html` lines 2148 and 2150.
The correct behaviour already exists in `prototype/pokai-app-bundled.html`. This
is the highest-priority code defect on the project — see `docs/STATUS.md`.

## Tier 1 MVP

**Status as of 2026-08-31: none of the twelve items below is delivered in a form
a real user could use, because nothing persists and nothing is deployed with a
working backend.** Items 1–4 and 8 exist as prototype code that runs in a browser
but saves nothing. See `docs/STATUS.md`.

The things that must work before anything else is worth building:

1. Accurate card recognition
2. Exact variant identification (set, print, edition — not just the Pokémon)
3. A visible confidence score, so the user knows how sure the system is
4. Instant value on identification
5. Collection portfolio with total value
6. Valuation and value tracking over time
7. Scan history
8. Manual correction when the scanner gets it wrong
9. Condition tracking
10. Market transparency — where a price came from and when it was updated

## Core values

Accuracy. Transparency. Trust. Speed. Simplicity. Ownership. Security.
Education. Fairness. Continuous improvement.

These are not decoration. Two have concrete engineering consequences:

- **Transparency** means prices show their source and age, and failures show
  their real cause.
- **Continuous improvement** means user corrections are captured as training
  signal. When someone fixes a misidentification, that correction is data about
  which card pairs the scanner confuses. Design for capturing it.

## Explicitly out of scope for now

Trading between users, marketplace/selling, social feeds, and deck building.
These come up in conversation but are not MVP. Do not build toward them without
Sterling asking.
