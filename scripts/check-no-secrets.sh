#!/usr/bin/env bash
#
# Fail if anything that looks like a real credential is committed.
#
# WHY THIS EXISTS. This repository is public. A key committed here is published
# to the world the moment it is pushed, and rotating it afterwards does not
# un-publish it. GitHub's own secret scanning catches some of these, but only
# after the push and only for providers it recognises -- tcgapi.dev is not one.
#
# The patterns require a plausible VALUE, not just a prefix, so documentation
# and .env.example can keep talking about `sb_secret_...` without tripping it.
set -uo pipefail

# provider prefixes, then a length that a real key would have
PATTERNS=(
  'sb_secret_[A-Za-z0-9_-]{15,}'          # Supabase service-role / secret
  'sk-ant-[A-Za-z0-9_-]{20,}'             # Anthropic
  'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.'  # a signed JWT (legacy Supabase keys)
  'sk_live_[A-Za-z0-9]{20,}'              # Stripe live
  '0x4AAAAAAA[A-Za-z0-9_-]{15,}'          # Cloudflare Turnstile secret
)

status=0
for p in "${PATTERNS[@]}"; do
  # Tracked files only. --cached would miss nothing on CI, where the tree is the commit.
  if hits=$(git grep -nIE "$p" -- ':!scripts/check-no-secrets.sh' 2>/dev/null); then
    echo "::error::A committed value matches a credential pattern: $p"
    # Show WHERE, never the value itself -- printing it here would publish it
    # again in the build log, which is also public on a public repository.
    echo "$hits" | sed -E "s/$p/[REDACTED]/g"
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  cat <<'MSG'

A key appears to be committed. Do NOT just delete it and push again -- it is
already in the git history and, on a public repository, already published.

  1. Rotate the key at the provider immediately. Treat it as compromised.
  2. Put the new value in Vercel -> Settings -> Environment Variables.
  3. Then remove it from the code.

Keys never belong in this repository. See CLAUDE.md and docs/HANDOVER.md §5.
MSG
fi

exit "$status"
