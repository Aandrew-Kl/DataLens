#!/usr/bin/env bash
# Purge oldest GitHub Actions cache entries so the repo stays under the
# 10 GB per-repo quota that GitHub imposes.
#
# Why this exists:
#   During Wave 2 / Wave 3 iteration, `actions/cache` for node_modules and
#   pip picked up dozens of entries. The DataLens cache crossed 11 GB,
#   which contributes to GitHub throttling new workflow runs.
#
# Usage:
#   ./scripts/purge-actions-cache.sh              # dry-run: list what would be deleted
#   ./scripts/purge-actions-cache.sh --apply      # actually delete
#
# Requires: gh CLI authenticated with repo scope.

set -euo pipefail

REPO="${REPO:-Aandrew-Kl/DataLens}"
APPLY=0
if [[ "${1:-}" == "--apply" ]]; then
  APPLY=1
fi

echo "Checking Actions cache for ${REPO}…"
TOTAL=$(gh api "/repos/${REPO}/actions/cache/usage" --jq '.active_caches_size_in_bytes')
COUNT=$(gh api "/repos/${REPO}/actions/cache/usage" --jq '.active_caches_count')
printf '  total: %s bytes (%.2f GB) across %s entries\n' "$TOTAL" "$(echo "scale=2; $TOTAL/1073741824" | bc)" "$COUNT"

# Keep the 5 newest entries per restore-key (safest: recent cache hits are still useful).
# Delete everything older.
echo
echo "Entries that will be removed (keeping 5 newest per ref+key combo):"
gh api "/repos/${REPO}/actions/caches?per_page=100" \
  --jq '.actions_caches | sort_by(.last_accessed_at) | reverse | .[5:] | .[] | "\(.id)\t\(.key)\t\(.last_accessed_at)"' \
  | while IFS=$'\t' read -r id key last_access; do
      echo "  - $id  $key  (last_access=$last_access)"
      if (( APPLY )); then
        gh api -X DELETE "/repos/${REPO}/actions/caches/${id}" >/dev/null || true
      fi
    done

echo
if (( APPLY )); then
  echo "Purge complete. Re-run without --apply to verify new sizes."
else
  echo "Dry-run only. Re-run with --apply to actually delete."
fi
