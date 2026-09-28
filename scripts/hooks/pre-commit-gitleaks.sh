#!/usr/bin/env sh
# Blocks a commit whose staged changes contain a secret (mw-e00.5). Called from .beads/hooks/pre-commit,
# which is the repo's hooks path (`pnpm hooks:install`). CI's `secrets` job is the backstop.
if ! command -v gitleaks >/dev/null 2>&1; then
  echo >&2 "gitleaks is not installed, so staged changes were not scanned for secrets (brew install gitleaks)."
  exit 0
fi
root=$(git rev-parse --show-toplevel)
if ! gitleaks git --pre-commit --staged --redact --no-banner --verbose --config "$root/.gitleaks.toml" "$root"; then
  echo >&2 "Commit blocked: staged changes contain what looks like a secret (redacted above)."
  echo >&2 "Remove it, or if it is a false positive add an explained allowlist entry to .gitleaks.toml."
  exit 1
fi
