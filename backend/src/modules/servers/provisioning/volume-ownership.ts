/**
 * Ownership-drift repair script for sandbox volumes.
 *
 * File helpers (upload, extract, restore) run as root, while the sandbox
 * itself runs as 1000:1000 — and the provision-time `chown -R` only runs at
 * container creation. So anything landing in /data afterwards stays
 * root-owned, and the first WRITE (npm/pip install, lockfiles) dies with
 * EACCES while reads keep working — the drift stays invisible until an
 * install path needs the disk. The symptom is a crash loop with EACCES in
 * the logs and SIGKILLed exec shells (code 137) on every container death.
 *
 * The script is a fixed string (the volume travels via the bind mount, never
 * interpolated): if any entry is not owned by 1000, re-chown the tree,
 * otherwise do nothing. The `find | head -n 1` idiom short-circuits on the
 * first mismatch and is portable across busybox/GNU (no `-quit` assumed).
 */
export function ownershipRepairScript(): string {
  return (
    `if [ -n "$(find /data ! -user 1000 2>/dev/null | head -n 1)" ]; ` +
    `then echo "[troxe] fixing volume ownership..." && chown -R 1000:1000 /data && chmod 750 /data; fi`
  );
}
