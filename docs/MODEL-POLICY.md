# Model policy — making the usage budget last

Sterling asked for a way to stop burning through usage limits. This is it.

The short version: **Opus thinks, Sonnet fetches.** Most of the work on a
project like this is not hard — it is reading files, counting things, running
commands, and copying facts between documents. That work does not need the
expensive model, and paying for it with the expensive model is why limits run
out mid-task.

## How the split works in practice

There are three helper agents defined in `.claude/agents/`. Each one is pinned
to Sonnet in its own configuration file, so the routing happens automatically —
nobody has to remember to ask for it.

| Agent | Runs on | Used for |
|---|---|---|
| `scout` | Sonnet | Searching the codebase, listing and counting things, reading large files, tracing where something is used |
| `verifier` | Sonnet | Running builds, tests, linters, servers, and network checks, and reporting the raw output |
| `scribe` | Sonnet | Mechanical doc edits once a decision is already made |

The main conversation stays on Opus and handles the things that actually need
judgment: architecture and stack decisions, the recognition and confidence
logic, security review, debugging anything subtle, tradeoff conversations with
Sterling, and deciding what the helper agents get asked in the first place.

## Why this saves real money

`index.html` is 2.7 MB. Reading it into the main conversation costs a large
share of a session's budget in one go, and it stays there for the rest of the
session. Handing that job to a Sonnet scout, which reads the file and returns a
one-page summary, costs a small fraction and keeps the main thread clear for
the work that needs it. The same logic applies to test output, log files, and
dependency trees.

## The rule to apply when it's unclear

Ask: **would a careful junior engineer get this right with clear instructions?**

- Yes → Sonnet. Searching, counting, running, transcribing, summarising.
- No → Opus. Anything where being wrong is expensive, subtle, or hard to notice.

Two things stay on Opus regardless of how mechanical they look, because being
quietly wrong about them is very costly here:

- **Anything touching recognition confidence or the "never guess" rule.** A
  scoring bug is silent — see `docs/SCANNER.md` for the version of this that
  made auto-accept mathematically unreachable and went unnoticed.
- **Anything touching secrets, auth, or money.**

## What this does not do

This reduces cost per session. It does not make a bad plan cheap. The largest
saving available on this project is still not building the wrong thing — which
is what the audit in `docs/STATUS.md` is for.
