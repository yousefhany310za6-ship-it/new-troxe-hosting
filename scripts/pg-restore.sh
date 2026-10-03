#!/usr/bin/env bash
#
# Troxe Hosting — PostgreSQL disaster restore (run on the DB host).
#
# Restores a .dump file (made by pg-backup.sh) into the troxe database,
# dropping and recreating objects (-c). THIS DESTROYS CURRENT DATA.
#
# Safety rails (all intentional friction):
#   1. refuses unless you type the database name at the prompt
#      (or pass --force, for automation that already confirmed elsewhere)
#   2. takes a pre-restore safety dump first (restorable if you picked wrong)
#   3. stops the API container if it is running (name guessable, skipped if
#      absent) so no writes land mid-restore; does NOT restart it (you do,
#      after verifying)
#
# Usage:
#   sudo ./scripts/pg-restore.sh /var/backups/troxe-postgres/troxe-20250101-030000.dump [--force]
#
set -euo pipefail

DUMP="${1:?usage: pg-restore.sh <file.dump> [--force]}"
FORCE="${2:-}"
PG_CONTAINER="${PG_CONTAINER:-troxe-postgres}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-troxe}"
API_CONTAINER="${API_CONTAINER:-troxe-api}"

if [ ! -f "$DUMP" ]; then
  echo "refusing: dump file not found: $DUMP" >&2
  exit 1
fi
if ! docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
  echo "refusing: container $PG_CONTAINER not found" >&2
  exit 1
fi
# readability check runs INSIDE the container: the DB host needs no local
# postgres client, and the archive is validated where it will be restored.
CHECK_TMP="/tmp/troxe-restore-check-$$.dump"
docker cp "$DUMP" "$PG_CONTAINER:$CHECK_TMP" >/dev/null
if ! docker exec "$PG_CONTAINER" pg_restore --list "$CHECK_TMP" >/dev/null 2>&1; then
  docker exec "$PG_CONTAINER" rm -f "$CHECK_TMP" >/dev/null 2>&1 || true
  echo "refusing: $DUMP is not a readable pg custom-format archive (try the file on the DB host, not a partial)" >&2
  exit 1
fi
docker exec "$PG_CONTAINER" rm -f "$CHECK_TMP" >/dev/null 2>&1 || true

if [ "$FORCE" != "--force" ]; then
  echo "ABOUT TO DESTROY all data in database '$PG_DB' on container '$PG_CONTAINER'"
  echo "and replace it with: $DUMP"
  read -r -p "Type the database name ($PG_DB) to continue: " CONFIRM
  if [ "$CONFIRM" != "$PG_DB" ]; then
    echo "aborted."
    exit 1
  fi
fi

echo "==> safety dump of current data ..."
SAFETY="$(dirname "$DUMP")/pre-restore-$(date -u +%Y%m%d-%H%M%S).dump"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$SAFETY"
chmod 600 "$SAFETY"
echo "    safety dump: $SAFETY"

if docker inspect "$API_CONTAINER" >/dev/null 2>&1; then
  echo "==> stopping $API_CONTAINER ..."
  docker stop "$API_CONTAINER"
fi

echo "==> restoring (this drops and recreates objects) ..."
docker exec -i "$PG_CONTAINER" pg_restore -U "$PG_USER" --if-exists -c -d "$PG_DB" < "$DUMP"

echo
echo "Restore finished. Verify, then start the API yourself:"
echo "  docker start $API_CONTAINER   # (only if you stopped it above)"
echo "  curl -s http://127.0.0.1:3300/api/v1/health/ready"
echo "If this was the wrong file, your previous data is at: $SAFETY"
