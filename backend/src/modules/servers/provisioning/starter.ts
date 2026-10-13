/**
 * Starter file(s) for a brand-new sandbox volume.
 *
 * The platform ships no code of its own, so a fresh volume is empty and the
 * runtime's default startup (`node index.js`, `python main.py`, `/data/server`)
 * exits immediately — MODULE_NOT_FOUND for the JS runtimes, and for Go/Rust
 * there is not even a binary to exec. The server then reports
 * `Process crashed` before the client has uploaded anything.
 *
 * Seeding fixes that first-run experience. Two shapes exist:
 *
 *   `starter`      one file (`index.js`, `main.py`, `main.rs`)
 *   `starterFiles` a small compilable PROJECT — Go needs go.mod + main.go,
 *                  Rust needs Cargo.toml + src/main.rs, because a single file
 *                  would not build and the first start would fail for a reason
 *                  that has nothing to do with the client.
 *
 * Neither may ever touch a volume the client already owns, so both are gated
 * on the volume being empty apart from our `.troxe-init` marker.
 */

export interface Starter {
  path: string;
  content: string;
}

/**
 * Shell fragment that writes one starter into an empty `root`.
 *
 * - The emptiness test filters out `.troxe-init` with a PLAIN `$` anchor:
 *   `grep -v '^\.troxe-init$'`. Writing `\$` inside those single quotes means
 *   "literal dollar", the marker stops matching, `grep -v` reports it as
 *   content and every seed is silently skipped — which is exactly how this
 *   bug shipped the first time. The unit suite runs this fragment through a
 *   real `sh` instead of trusting it to look right.
 * - The payload travels base64: starter content holds quotes, backticks and
 *   `$` that must never be interpreted by the helper's shell.
 * - Nested directories (Rust's `src/main.rs`) are created first, or the write
 *   fails on a volume that has no `src/`.
 * - `root` exists for that same test; production passes the default `/data`.
 * - Returns `:` (a no-op statement) when there is nothing to seed, so callers
 *   can always wrap it as `{ ${starterSeed(...)}; }`.
 *
 * `paths` is a relative path check, NOT a sandbox escape check: a path like
 * `../../etc/passwd` is rejected outright. Everything written stays under root.
 */
export function starterSeed(starter: Starter | undefined, root = '/data'): string {
  return starterFilesSeed(starter ? [starter] : undefined, root);
}

/**
 * The same seeding for one-or-many files. Every path is validated first, and
 * if ANY of them is invalid the whole fragment degrades to a no-op: a partial
 * seed (Cargo.toml without src/main.rs) is worse than none, because it produces
 * a confusing build error the client cannot act on.
 */
export function starterFilesSeed(starters: Starter[] | undefined, root = '/data'): string {
  if (!starters?.length) return ':';
  // Path validation, and it is STRICTER than it looks: every segment must be a
  // plain name. A regex that merely allows `.` and `/` also allows `..`, which
  // is exactly the traversal an earlier version of this check permitted — the
  // unit suite now proves `../../etc/passwd` produces a no-op.
  const safe = starters.every((s) => {
    if (!s.path || s.path.startsWith('/')) return false;
    const segments = s.path.split('/');
    return segments.every((seg) => /^[A-Za-z0-9._-]+$/.test(seg) && seg !== '..' && seg !== '.');
  });
  if (!safe) return ':';
  const writes = starters
    .map((s) => {
      const b64 = Buffer.from(s.content, 'utf8').toString('base64');
      const dir = s.path.includes('/') ? s.path.slice(0, s.path.lastIndexOf('/')) : '';
      const mkdir = dir ? `mkdir -p '${root}/${dir}' 2>/dev/null || :; ` : '';
      return `${mkdir}echo '${b64}' | base64 -d > '${root}/${s.path}' || :;`;
    })
    .join(' ');
  return (
    `if [ -z "$(ls -A ${root} 2>/dev/null | grep -v '^\\.troxe-init$' | head -n 1)" ]; then ` +
    `${writes} fi`
  );
}