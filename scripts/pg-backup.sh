#!/usr/bin/env bash
#
# Troxe Hosting — scheduled PostgreSQL backup (run on the API/DB host).
#
# Dumps the troxe database in custom format (-Fc: compressed + restorable
# table-by-table) via `docker exec`, so the host needs no pg client.
# Keeps the newest $RETAIN dumps, prunes the rest. Overlaps are refused
# via flock (a second run exits quietly instead of piling on).
#
# Usage:
#   sudo PG_CONTAINER=troxe-postgres BACKUP_DIR=/var/backups/troxe-postgres \
#     RETAIN_DAYS=7 ./scripts/pg-backup.sh
#
# Schedule (root crontab — daily 03:00):
#   0 3 * * * /opt/new-troxe-hosting/scripts/pg-backup.sh >>/var/log/troxe-pg-backup.log 2>&1
#
# Env (all optional except when noted):
#   PG_CONTAINER  docker container name of Postgres   [default: troxe-postgres]
#   PG_USER       database user                       [default: postgres]
#   PG_DB         database name                       [default: troxe]
#   BACKUP_DIR    host directory for dumps (created)  [default: /var/backups/troxe-postgres]
#   RETAIN_DAYS   how many newest dumps to keep       [default: 7]
#
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-troxe-postgres}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-troxe}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/troxe-postgres}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"
LOCK="/tmp/troxe-pg-backup.lock"

log() { echo "$(date -u +%FT%TZ) $*"; }

if ! [[ "$RETAIN_DAYS" =~ ^[0-9]+$ ]] || [ "$RETAIN_DAYS" -lt 1 ]; then
  log "refusing: RETAIN_DAYS must be a positive integer" >&2
  exit 1
fi
if ! docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
  log "refusing: container $PG_CONTAINER not found" >&2
  exit 1
fi

exec 9>"$LOCK"
if ! flock -n 9; then
  log "another backup is running, exiting quietly"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
TMP="$BACKUP_DIR/.troxe-$STAMP.dump.partial"
OUT="$BACKUP_DIR/troxe-$STAMP.dump"

log "dumping $PG_DB from $PG_CONTAINER ..."
if ! docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$TMP"; then
  rm -f "$TMP"
  log "pg_dump failed" >&2
  exit 1
fi
# a truncated/empty dump must never become the 'latest' backup
if [ ! -s "$TMP" ]; then
  rm -f "$TMP"
  log "dump is empty, refusing to publish" >&2
  exit 1
fi
chmod 600 "$TMP"
mv "$TMP" "$OUT"
SIZE=$(du -h "$OUT" | cut -f1)
log "wrote $OUT ($SIZE)"

# retention: newest N only (ls -t is newest-first; --quoting-style escapes spaces)
mapfile -t OLD < <(ls -t "$BACKUP_DIR"/troxe-*.dump 2>/dev/null | tail -n +"$((RETAIN_DAYS + 1))" || true)
for f in ${OLD[@]+"${OLD[@]}"}; do
  [ -n "$f" ] && rm -f "$f" && log "pruned $(basename "$f")"
done

log "done. newest $RETAIN_DAYS dumps kept in $BACKUP_DIR"
log "NEXT: copy $BACKUP_DIR off this host (rsync/S3) — a backup that lives"
log "only on the machine it backs up is not a backup."
