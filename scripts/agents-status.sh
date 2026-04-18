#!/usr/bin/env bash
# Live status panel for DataLens autonomous orchestration.
# Run in a separate terminal: `watch -n 5 ./scripts/agents-status.sh`
# Or one-shot: `./scripts/agents-status.sh`
#
# Shows: Codex agent status, log growth, commits per branch, PR CI state.

set -uo pipefail

C_BOLD=$'\e[1m'
C_DIM=$'\e[2m'
C_GRN=$'\e[32m'
C_YLW=$'\e[33m'
C_RED=$'\e[31m'
C_END=$'\e[0m'

echo "${C_BOLD}━━━━━━━━━━━━━━━━ DATALENS · ORCHESTRATION STATUS ━━━━━━━━━━━━━━━━${C_END}"
date '+%Y-%m-%d %H:%M:%S'
echo

# --- Codex agents ----------------------------------------------------------
echo "${C_BOLD}Codex agents${C_END}"
for pidfile in /tmp/w3_*.pid /tmp/w4_*.pid; do
  [ -f "$pidfile" ] || continue
  base=$(basename "$pidfile" .pid)
  pid=$(cat "$pidfile" 2>/dev/null)
  log="/tmp/${base}.log"
  if [ -f "$log" ]; then
    size=$(wc -c < "$log" | tr -d ' ')
    sizeKB=$(( size / 1024 ))
  else
    sizeKB=0
  fi
  if [ -n "$pid" ] && ps -p "$pid" -o pid= >/dev/null 2>&1; then
    state="${C_GRN}alive${C_END}"
  else
    state="${C_DIM}done${C_END}"
  fi
  # Extract token usage if present in log
  tokens=$(grep -oE "tokens used [0-9,]+" "$log" 2>/dev/null | tail -1 | awk '{print $NF}')
  printf '  %-30s %s  log=%dKB  %s\n' "$base" "$state" "$sizeKB" "${tokens:+tokens=$tokens}"
done
echo

# --- Branch commits --------------------------------------------------------
echo "${C_BOLD}Branches (commits ahead of main)${C_END}"
for branch in improvement/wave-3 improvement/wave-4; do
  if git -C /tmp/DataLens_review show-ref --quiet "refs/heads/$branch"; then
    n=$(git -C /tmp/DataLens_review log --oneline "main..$branch" 2>/dev/null | wc -l | tr -d ' ')
    last=$(git -C /tmp/DataLens_review log -1 --format='%h %s' "$branch" 2>/dev/null | head -c 80)
    printf '  %-22s %2d commits  │ %s\n' "$branch" "$n" "$last"
  fi
done
echo

# --- PR CI state -----------------------------------------------------------
echo "${C_BOLD}Open PRs${C_END}"
for pr in 17 18; do
  state=$(gh pr view "$pr" --json state,mergeable --jq '"\(.state) \(.mergeable)"' 2>/dev/null || echo "N/A")
  if [ "$state" != "N/A" ]; then
    printf '  PR #%s  %s\n' "$pr" "$state"
    gh pr checks "$pr" 2>&1 | awk -v grn="$C_GRN" -v yw="$C_YLW" -v rd="$C_RED" -v end="$C_END" '
      NR<=6 {
        color=yw
        if ($2=="pass") color=grn
        if ($2=="fail") color=rd
        printf "    %s%-10s%s  %s  %s\n", color, $2, end, $1, $3
      }' 2>/dev/null
  fi
done
echo

# --- Actions quota / cache -------------------------------------------------
echo "${C_BOLD}GH Actions cache${C_END}"
gh api /repos/Aandrew-Kl/DataLens/actions/cache/usage 2>/dev/null | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    b = d['active_caches_size_in_bytes']
    c = d['active_caches_count']
    gb = b/1073741824
    pct = gb/10*100
    bar = '█' * int(pct/10) + '░' * (10 - int(pct/10))
    color = '\033[32m' if gb < 8 else ('\033[33m' if gb < 10 else '\033[31m')
    print(f'  {color}[{bar}]\033[0m  {gb:.2f}/10 GB ({pct:.0f}%)  ·  {c} entries')
except Exception as e:
    print('  (unable to read)')
"
echo
