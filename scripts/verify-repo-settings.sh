#!/usr/bin/env bash
# Reads the live repository settings and diffs them against scripts/repo-settings.env (mw-e00.10).
# Exits 0 with "no drift", or 1 listing every difference. Read-only; needs a gh login that can read
# branch protection (repo admin).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/repo-settings.env
source scripts/repo-settings.env

drift=0
expect() { # name expected actual
  if [ "$2" != "$3" ]; then
    echo "DRIFT  $1: expected $2, got $3"
    drift=1
  else
    echo "ok     $1 = $3"
  fi
}

repo=$(gh api "repos/$REPO")
expect allow_squash_merge true "$(jq -r .allow_squash_merge <<<"$repo")"
expect allow_merge_commit false "$(jq -r .allow_merge_commit <<<"$repo")"
expect allow_rebase_merge false "$(jq -r .allow_rebase_merge <<<"$repo")"
expect delete_branch_on_merge true "$(jq -r .delete_branch_on_merge <<<"$repo")"
expect allow_auto_merge false "$(jq -r .allow_auto_merge <<<"$repo")"

if ! protection=$(gh api "repos/$REPO/branches/$BRANCH/protection" 2>/dev/null); then
  echo "DRIFT  $BRANCH is not protected"
  exit 1
fi
expect strict_status_checks true "$(jq -r .required_status_checks.strict <<<"$protection")"
expect enforce_admins true "$(jq -r .enforce_admins.enabled <<<"$protection")"
expect required_linear_history true "$(jq -r .required_linear_history.enabled <<<"$protection")"
expect allow_force_pushes false "$(jq -r .allow_force_pushes.enabled <<<"$protection")"
expect allow_deletions false "$(jq -r .allow_deletions.enabled <<<"$protection")"
expect required_reviews none "$(jq -r 'if .required_pull_request_reviews then "set" else "none" end' <<<"$protection")"
read -ra check_names <<<"$REQUIRED_CHECKS"
want=$(printf '%s\n' "${check_names[@]}" | sort | tr '\n' ' ')
have=$(jq -r '.required_status_checks.checks[].context' <<<"$protection" | sort | tr '\n' ' ')
expect required_checks "$want" "$have"

if [ "$drift" -eq 0 ]; then echo "no drift"; fi
exit "$drift"
