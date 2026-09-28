#!/usr/bin/env bash
# Applies the repository and main-branch settings in scripts/repo-settings.env (mw-e00.10).
# Idempotent: it PUTs/PATCHes the full desired state, so a second run changes nothing.
# Needs a gh login with admin rights on the repo. Verify afterwards with scripts/verify-repo-settings.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/repo-settings.env
source scripts/repo-settings.env

echo "Repository merge settings: squash only, delete head branches, no auto-merge"
gh api -X PATCH "repos/$REPO" --silent \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F allow_auto_merge=false \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY

echo "Branch protection on $BRANCH: required checks, up to date, linear history, no force-push or deletion"
read -ra check_names <<<"$REQUIRED_CHECKS"
checks=$(printf '%s\n' "${check_names[@]}" | jq -R '{context: .}' | jq -s .)
jq -n --argjson checks "$checks" '{
  required_status_checks: { strict: true, checks: $checks },
  enforce_admins: true,
  required_pull_request_reviews: null,
  restrictions: null,
  required_linear_history: true,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: false,
  block_creations: false,
  lock_branch: false,
  allow_fork_syncing: false
}' | gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" --input - --silent

echo "Done. Run scripts/verify-repo-settings.sh to confirm there is no drift."
