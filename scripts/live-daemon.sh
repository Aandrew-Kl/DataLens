#!/usr/bin/env bash
# DataLens live status daemon — writes a styled snapshot to
# /tmp/datalens-live.txt every 2 seconds. Both the user (with `watch`/loop)
# and the assistant (via Read/cat) see the SAME file.
#
# Usage:
#   bash /tmp/DataLens_review/scripts/live-daemon.sh &
#   # user watches:
#   while true; do clear; cat /tmp/datalens-live.txt; sleep 2; done
#
# Stop:
#   pkill -f live-daemon.sh

OUT=/tmp/datalens-live.txt
REPO=/tmp/DataLens_review
GH_REPO=Aandrew-Kl/DataLens

# ANSI colors
RESET=$'\033[0m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[31m'
GRN=$'\033[32m'
YLW=$'\033[33m'
BLU=$'\033[34m'
MGN=$'\033[35m'
CYN=$'\033[36m'
WHT=$'\033[37m'
BG_GRN=$'\033[42m'
BG_RED=$'\033[41m'

# progress bar: $1=fill (0-width), $2=width, $3=color
bar() {
  local fill=$1 width=$2 color=$3
  local empty=$((width - fill))
  printf "${color}"
  printf '█%.0s' $(seq 1 $fill 2>/dev/null)
  printf "${DIM}"
  printf '░%.0s' $(seq 1 $empty 2>/dev/null)
  printf "${RESET}"
}

# status dot: $1=alive?(0/1)
dot() {
  if [ "$1" = "1" ]; then
    printf "${GRN}●${RESET}"
  else
    printf "${DIM}○${RESET}"
  fi
}

# state badge: $1=alive?(0/1)
badge() {
  if [ "$1" = "1" ]; then
    printf "${BG_GRN}${BOLD} RUNNING ${RESET}"
  else
    printf "${DIM} done    ${RESET}"
  fi
}

render() {
  local now cols
  now=$(date '+%H:%M:%S')
  cols=$(tput cols 2>/dev/null || echo 80)
  [ "$cols" -gt 100 ] && cols=100
  local bar_width=$((cols - 40))
  [ "$bar_width" -lt 20 ] && bar_width=20
  [ "$bar_width" -gt 50 ] && bar_width=50

  {
    # ═══ Header ═════════════════════════════════════════════════════════
    printf "${BOLD}${MGN}"
    printf '╔══════════════════════════════════════════════════════════════════════════════╗\n'
    printf '║   '
    printf "${CYN}DATALENS${RESET}${BOLD}${MGN}"
    printf '  ·  '
    printf "${WHT}ORCHESTRATION LIVE${MGN}"
    printf '  ·  %s                              ║\n' "$now"
    printf '╚══════════════════════════════════════════════════════════════════════════════╝\n'
    printf "${RESET}\n"

    # ═══ Agents ═════════════════════════════════════════════════════════
    printf "${BOLD}${CYN}▸ Codex agents${RESET}\n"
    printf "${DIM}────────────────────────────────────────────────────────────────────────${RESET}\n"

    local total=0 alive_count=0 done_count=0
    for pidfile in /tmp/w*_*.pid; do
      [ -f "$pidfile" ] || continue
      total=$((total + 1))
      local pid=$(cat "$pidfile" 2>/dev/null)
      if [ -n "$pid" ] && ps -p "$pid" -o pid= >/dev/null 2>&1; then
        alive_count=$((alive_count + 1))
      else
        done_count=$((done_count + 1))
      fi
    done

    printf '  Total: %s%d%s  │  ' "$BOLD" "$total" "$RESET"
    printf "${GRN}● running: %d${RESET}  │  ${DIM}○ done: %d${RESET}\n\n" "$alive_count" "$done_count"

    for pidfile in /tmp/w*_*.pid; do
      [ -f "$pidfile" ] || continue
      local base pid log sizeKB tokens lastline alive=0 max_kb=3200 fill
      base=$(basename "$pidfile" .pid)
      pid=$(cat "$pidfile" 2>/dev/null)
      log="/tmp/${base}.log"
      if [ -f "$log" ]; then
        sizeKB=$(( $(wc -c < "$log") / 1024 ))
      else
        sizeKB=0
      fi
      [ -n "$pid" ] && ps -p "$pid" -o pid= >/dev/null 2>&1 && alive=1
      tokens=$(grep -oE "tokens used [0-9,]+" "$log" 2>/dev/null | tail -1 | awk '{print $NF}')
      lastline=$(tail -1 "$log" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | tr '\t' ' ' | cut -c 1-52)

      # bar width for log size (scale: 3200KB = full)
      fill=$(( sizeKB * bar_width / max_kb ))
      [ "$fill" -gt "$bar_width" ] && fill=$bar_width
      [ "$fill" -lt 1 ] && fill=1

      # color based on state
      local bcolor="$DIM"
      [ "$alive" = "1" ] && bcolor="$GRN"

      printf '  %s  %-26s ' "$(dot $alive)" "$base"
      bar "$fill" "$bar_width" "$bcolor"
      printf '  %5dKB' "$sizeKB"
      [ -n "$tokens" ] && printf "  ${YLW}%s tok${RESET}" "$tokens"
      printf '\n'
      [ -n "$lastline" ] && printf "    ${DIM}└─ %s${RESET}\n" "$lastline"
    done
    printf '\n'

    # ═══ Branches ═══════════════════════════════════════════════════════
    printf "${BOLD}${CYN}▸ Branches (commits ahead of main)${RESET}\n"
    printf "${DIM}────────────────────────────────────────────────────────────────────────${RESET}\n"
    for br in improvement/wave-3 improvement/wave-4; do
      n=$(git -C "$REPO" log --oneline "main..$br" 2>/dev/null | wc -l | tr -d ' ')
      last=$(git -C "$REPO" log -1 --format='%h  %s' "$br" 2>/dev/null | cut -c 1-65)
      local clr="$GRN"
      [ "$n" = "0" ] && clr="$DIM"
      printf '  %s%-22s%s  %s%2d ahead%s  │  ${DIM}%s${RESET}\n' \
        "$BOLD" "$br" "$RESET" "$clr" "$n" "$RESET" "$last"
    done
    printf '\n'

    # ═══ Open PRs ══════════════════════════════════════════════════════
    printf "${BOLD}${CYN}▸ Open PRs${RESET}\n"
    printf "${DIM}────────────────────────────────────────────────────────────────────────${RESET}\n"
    local any_pr=0
    for pr in 17 18; do
      state=$(gh pr view "$pr" --json state --jq '.state' 2>/dev/null)
      [ -z "$state" ] && continue
      any_pr=1
      merge=$(gh pr view "$pr" --json mergeable --jq '.mergeable' 2>/dev/null)
      title=$(gh pr view "$pr" --json title --jq '.title' 2>/dev/null | cut -c 1-55)

      local sclr="$GRN"
      [ "$state" != "OPEN" ] && sclr="$DIM"
      local mclr="$GRN"
      [ "$merge" != "MERGEABLE" ] && mclr="$YLW"

      printf '  ${BOLD}PR #%s${RESET}  %s%s%s  %s%s%s\n    ${DIM}%s${RESET}\n' \
        "$pr" "$sclr" "$state" "$RESET" "$mclr" "$merge" "$RESET" "$title"
      gh pr checks "$pr" 2>&1 | head -5 | while IFS=$'\t' read -r job status rest; do
        [ -z "$job" ] && continue
        local cclr="$WHT"
        local icon="◌"
        case "$status" in
          pass)     cclr="$GRN"; icon="✓" ;;
          fail)     cclr="$RED"; icon="✗" ;;
          pending)  cclr="$YLW"; icon="◌" ;;
          skipping) cclr="$DIM"; icon="∘" ;;
        esac
        printf "      %s%s %-10s %s%s\n" "$cclr" "$icon" "$job" "$status" "$RESET"
      done
      printf '\n'
    done
    [ "$any_pr" = "0" ] && printf "  ${DIM}(no open PRs returned)${RESET}\n\n"

    # ═══ Cache =========================================================
    printf "${BOLD}${CYN}▸ GH Actions cache${RESET}\n"
    printf "${DIM}────────────────────────────────────────────────────────────────────────${RESET}\n"
    gh api "/repos/${GH_REPO}/actions/cache/usage" 2>/dev/null | python3 -c "
import json, sys, os
try:
    d = json.load(sys.stdin)
    b = d['active_caches_size_in_bytes']
    c = d['active_caches_count']
    gb = b/1073741824
    pct = min(100, gb/10*100)
    bw = 30
    fill = int(pct / 100 * bw)
    empty = bw - fill
    GRN='\033[32m'; YLW='\033[33m'; RED='\033[31m'; DIM='\033[2m'; RESET='\033[0m'; BOLD='\033[1m'
    color = GRN if gb < 8 else (YLW if gb < 10 else RED)
    bar = color + ('█' * fill) + DIM + ('░' * empty) + RESET
    print(f'  [{bar}]  {BOLD}{gb:.2f}{RESET} / 10 GB  ({pct:.0f}%%)  ·  {c} entries'.replace('%%','%'))
except Exception as e:
    print(f'  \\033[2m(unable to read: {e})\\033[0m')
"
    printf '\n'

    # ═══ Footer =========================================================
    printf "${DIM}"
    printf '────────────────────────────────────────────────────────────────────────\n'
    printf '  refresh: 2s  ·  stop: pkill -f live-daemon.sh  ·  file: %s\n' "$OUT"
    printf "${RESET}"
  } > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
}

echo "live-daemon starting → $OUT (refresh every 2s)" >&2
while true; do
  render 2>/dev/null
  sleep 2
done
