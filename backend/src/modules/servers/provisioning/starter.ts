/**
 * Starter file for a brand-new sandbox volume.
 *
 * The platform ships no code of its own, so a fresh volume is empty and the
 * runtime's default startup (`node index.js`, `python main.py`, …) exits with
 * MODULE_NOT_FOUND — the server then reports `Process crashed` before the
 * client has uploaded anything. Seeding one file fixes that first-run
 * experience; it must never touch a volume the client already owns.
 *
 * The fragment is appended to the volume-chown helper round trip, so it runs
 * on every create/reinstall with exactly one decision: write only when `/data`
 * holds nothing but our `.troxe-init` marker.
 */

export interface Starter {
  path: string;
  content: string;
}

/**
 * Shell fragment that writes `starter` into an empty `root`.
 *
 * - The emptiness test filters out `.troxe-init` with a PLAIN `$` anchor:
 *   `grep -v '^\.troxe-init$'`. Writing `\$` inside those single quotes means
 *   "literal dollar", the marker stops matching, `grep -v` reports it as
 *   content and every seed is silently skipped — which is exactly how this
 *   bug shipped the first time. The unit suite runs this fragment through a
 *   real `sh` instead of trusting it to look right.
 * - The payload travels base64: starter content holds quotes, backticks and
 *   `$` that must never be interpreted by the helper's shell.
 * - `root` exists for that same test; production passes the default `/data`.
 * - Returns `:` (a no-op statement) when there is nothing to seed, so callers
 *   can always wrap it as `{ ${starterSeed(...)}; }`.
 */
export function starterSeed(starter: Starter | undefined, root = '/data'): string {
  if (!starter?.content) return ':';
  // fixed token from images.ts — validated anyway so no traversal can be added
  if (!/^[A-Za-z0-9._-]+$/.test(starter.path)) return ':';
  const b64 = Buffer.from(starter.content, 'utf8').toString('base64');
  return (
    `if [ -z "$(ls -A ${root} 2>/dev/null | grep -v '^\\.troxe-init$' | head -n 1)" ]; then ` +
    `echo '${b64}' | base64 -d > '${root}/${starter.path}' || :; fi`
  );
}
