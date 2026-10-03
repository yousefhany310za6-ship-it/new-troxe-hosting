#!/usr/bin/env bash
#
# Troxe Hosting — host + stack health probe with optional alerting.
#
# Checks, in order:
#   1. API /health/ready        (HTTP, timeout-bounded)
#   2. Postgres container + a real query (not just "running")
#   3. Disk usage               (warn/crit thresholds)
#   4. Backup freshness         (newest pg dump must be < BACKUP_MAX_AGE_H)
#   5. Container states         (any troxe-* restarting/exited/unhealthy)
#
# Exit code: 0 healthy, 1 degraded (>=1 warning), 2 critical.
#
# Alerting: set one of
#   ALERT_WEBHOOK=https://discord.com/api/webhooks/...   (generic JSON POST)
#   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID                (Telegram message)
# Alerts are SUPPRESSED per check for ALERT_REPEAT_H hours after the last
# send (state file), so a 1-minute cron does not spam you all night.
#
# Usage:
#   ./scripts/healthcheck.sh                  # verbose, alerts on change
#   ./scripts/healthcheck.sh -q               # exit code only (for monitors)
#   DISK_CRIT=95 BACKUP_MAX_AGE_H=48 ./scripts/healthcheck.sh
#
# Cron (every 5 min):
#   */5 * * * * /opt/new-troxe-hosting/scripts/healthcheck.sh >>/var/log/troxe-health.log 2>&1
#
set -uo pipefail

API_URL="${API_URL:-http://127.0.0.1:3300/api/v1/health/ready}"
PG_CONTAINER="${PG_CONTAINER:-troxe-postgres}"
PG_DB="${PG_DB:-troxe}"
DISK_WARN="${DISK_WARN:-80}"
DISK_CRIT="${DISK_CRIT:-90}"
DISK_PATH="${DISK_PATH:-/}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/troxe-postgres}"
BACKUP_MAX_AGE_H="${BACKUP_MAX_AGE_H:-26}"
ALERT_REPEAT_H="${ALERT_REPEAT_H:-6}"
STATE_DIR="${STATE_DIR:-/tmp}"
STATE_FILE="$STATE_DIR/troxe-health.state"

QUIET=0
[ "${1:-}" = "-q" ] && QUIET=1

say() { [ "$QUIET" -eq 1 ] || echo "$@"; }

WORST=0   # 0 ok, 1 warn, 2 crit
ALERTS=()

raise() { # raise <level> <check> <message>
  local lvl="$1" check="$2" msg="$3"
  [ "$lvl" -gt "$WORST" ] && WORST=$lvl
  ALERTS+=("$lvl|$check|$msg")
  say "[$( [ "$lvl" -eq 2 ] && echo CRIT || echo WARN )] $check: $msg"
}

# ---------- 1. API readiness -------------------------------------------------
if ! API_BODY=$(curl -sf -m 8 "$API_URL" 2>/dev/null); then
  raise 2 api "no answer from $API_URL (process down, hung, or port blocked)"
elif ! grep -q '"status":"ok"' <<<"$API_BODY"; then
  raise 2 api "readiness degraded: $API_BODY"
else
  # postgres+docker sub-checks are inside the payload
  grep -q '"ok":false' <<<"$API_BODY" && raise 2 api "readiness reports failed check: $API_BODY"
  say "[ OK ] api: ready"
fi

# ---------- 2. Postgres (real query, not just container state) --------------
if ! docker inspect -f '{{.State.Running}}' "$PG_CONTAINER" >/dev/null 2>&1; then
  raise 2 postgres "container $PG_CONTAINER is not running"
elif ! docker exec "$PG_CONTAINER" psql -U postgres -d "$PG_DB" -tAc "select 1" >/dev/null 2>&1; then
  raise 2 postgres "container up but query failed (auth/ storage / crash loop)"
else
  say "[ OK ] postgres: answering queries"
fi

# ---------- 3. Disk ----------------------------------------------------------
DISK_PCT=$(df -P "$DISK_PATH" 2>/dev/null | awk 'NR==2{gsub("%","");print $5}')
if [ -z "${DISK_PCT:-}" ]; then
  raise 1 disk "could not read usage of $DISK_PATH"
elif [ "$DISK_PCT" -ge "$DISK_CRIT" ]; then
  raise 2 disk "$DISK_PATH at ${DISK_PCT}% (crit ${DISK_CRIT}%) — sandboxes and backups will start failing"
elif [ "$DISK_PCT" -ge "$DISK_WARN" ]; then
  raise 1 disk "$DISK_PATH at ${DISK_PCT}% (warn ${DISK_WARN}%)"
else
  say "[ OK ] disk: ${DISK_PCT}% on $DISK_PATH"
fi

# ---------- 4. Backup freshness ---------------------------------------------
if [ -d "$BACKUP_DIR" ]; then
  NEWEST=$(ls -t "$BACKUP_DIR"/troxe-*.dump 2>/dev/null | head -1)
  if [ -z "$NEWEST" ]; then
    raise 2 backup "no pg dump found in $BACKUP_DIR — pg-backup.sh has never run"
  else
    AGE_S=$(( $(date +%s) - $(stat -c %Y "$NEWEST") ))
    AGE_H=$(( AGE_S / 3600 ))
    if [ "$AGE_H" -ge "$BACKUP_MAX_AGE_H" ]; then
      raise 2 backup "newest dump is ${AGE_H}h old (limit ${BACKUP_MAX_AGE_H}h): $(basename "$NEWEST")"
    else
      say "[ OK ] backup: newest dump ${AGE_H}h old"
    fi
  fi
else
  raise 1 backup "backup dir $BACKUP_DIR missing — run pg-backup.sh first"
fi

# ---------- 5. Container states ---------------------------------------------
BAD=$(docker ps -a --format '{{.Names}}\t{{.Status}}' 2>/dev/null \
  | grep -E '^troxe-' | grep -Ev '\bUp\b' || true)
# allow one-shot helpers that legitimately exited
BAD=$(grep -Ev 'troxe-helper|troxe-node-bundle' <<<"$BAD" || true)
if [ -n "$BAD" ]; then
  raise 2 containers "not running: $(tr '\n' ';' <<<"$BAD")"
else
  say "[ OK ] containers: all troxe-* up"
fi

# ---------- report + alert ---------------------------------------------------
[ "$WORST" -eq 0 ] && say "[ OK ] all checks passed"

if [ "$WORST" -eq 0 ]; then
  # clear per-check suppression so a re-failure alerts again immediately
  [ -f "$STATE_FILE" ] && : > "$STATE_FILE"
  exit 0
fi

NOW=$(date +%s)
SEND=()
declare -A LAST
if [ -f "$STATE_FILE" ]; then
  while IFS='|' read -r k v; do [ -n "$k" ] && LAST["$k"]="$v"; done < "$STATE_FILE"
fi
: > "$STATE_FILE.tmp"
for a in "${ALERTS[@]}"; do
  IFS='|' read -r lvl check msg <<<"$a"
  prev="${LAST[$check]:-0}"
  if [ $(( NOW - prev )) -ge $(( ALERT_REPEAT_H * 3600 )) ]; then
    SEND+=("$lvl|$check|$msg")
  fi
  echo "$check|$NOW" >> "$STATE_FILE.tmp"
done
mv "$STATE_FILE.tmp" "$STATE_FILE"

if [ ${#SEND[@]} -gt 0 ]; then
  TEXT="troxe-hosting [$([ "$WORST" -eq 2 ] && echo CRITICAL || echo WARNING)] $(hostname -s) $(date -u +%FT%TZ)"
  for s in "${SEND[@]}"; do
    IFS='|' read -r lvl check msg <<<"$s"
    TEXT="$TEXT
- $check: $msg"
  done
  say "ALERT:"
  say "$TEXT"

  if [ -n "${ALERT_WEBHOOK:-}" ]; then
    curl -sf -m 10 -H 'Content-Type: application/json' \
      -d "$(printf '{"content":%s}' "$(printf '%s' "$TEXT" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"health alert"')")" \
      "$ALERT_WEBHOOK" >/dev/null 2>&1 \
      && say "  -> webhook delivered" || say "  -> webhook FAILED (check ALERT_WEBHOOK)"
  elif [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -sf -m 10 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${TEXT}" >/dev/null 2>&1 \
      && say "  -> telegram delivered" || say "  -> telegram FAILED (check token/chat id)"
  fi
fi

exit "$WORST"
