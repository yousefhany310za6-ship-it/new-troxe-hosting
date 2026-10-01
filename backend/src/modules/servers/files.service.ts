import { Injectable, Logger } from '@nestjs/common';
import { posix } from 'path';
import { config } from '../../config/env';
import { AppError, Err } from '../../common/errors';
import { ServersService } from './servers.service';
import { DockerService } from './provisioning/docker.service';

export interface FileEntry {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  mtime: number;
}

/**
 * Internal marker files that keep the volume functional (ownership, init).
 * Hidden from listings and untouchable through the API — the server must
 * look empty and ready on first open.
 */
const RESERVED = new Set(['.troxe-init']);

/**
 * File manager over a server's persistent volume.
 *
 * Every operation runs in an ephemeral helper container (net: none, capped,
 * no-new-privileges) with ONLY the target volume bound — the API process
 * itself never touches volume bytes, so this works whether the API runs on
 * the host or containerized.
 *
 * Path safety is enforced TWICE:
 *  1. Node: posix normalize + reject `..`/absolute/overlong (>512B, >32 deep).
 *  2. Helper: `realpath` containment under /data (kills symlink escapes),
 *     plus ancestor-symlink rejection before any mkdir/write.
 *
 * Transport is base64-over-logs (no stdin plumbing): text read/write cap
 * 512KB, binary upload 2MB, single-file download 8MB (raised log cap).
 */
@Injectable()
export class FilesService {
  private readonly log = new Logger(FilesService.name);

  constructor(
    private serversSvc: ServersService,
    private docker: DockerService,
  ) {}

  static readonly READ_MAX = 512 * 1024;
  static readonly WRITE_MAX = 512 * 1024;
  static readonly UPLOAD_MAX = 2 * 1024 * 1024;
  static readonly DOWNLOAD_MAX = 8 * 1024 * 1024;
  /** archive input / extraction output bounds (helper time + tarbomb safety) */
  static readonly ARCHIVE_MAX = 200 * 1024 * 1024;

  // ---- public API --------------------------------------------------------

  async list(ownerId: string, serverId: string, rel: string | undefined) {
    const { volume } = await this.volumeOf(ownerId, serverId);
    const dir = this.sanitizeDir(rel ?? '');
    const script = [
      `d=${this.q(`/data/${dir}`)}`,
      `[ -d "$d" ] || { echo TROXE_ERR=NOTDIR; exit 3; }`,
      `r=$(realpath "$d"); case "$r" in /data|/data/*) ;; *) echo TROXE_ERR=ESCAPE; exit 4;; esac`,
      `for f in "$d"/* "$d"/.*; do`,
      `  [ -e "$f" ] || [ -L "$f" ] || continue;`,
      `  b=$(basename "$f"); case "$b" in .|..) continue;; esac;`,
      `  t=$(stat -c %F "$f"); s=$(stat -c %s "$f"); m=$(stat -c %Y "$f");`,
      `  n=$(printf '%s' "$b" | base64 -w0);`,
      `  printf '%s|%s|%s|%s\\n' "$t" "$s" "$m" "$n";`,
      `done | sort`,
    ].join('\n');
    const res = await this.helper(volume, script, { ro: true, capture: true, timeoutMs: 30_000 });
    this.throwIfErr(res.out, res.code);
    const entries: FileEntry[] = [];
    for (const line of res.out.split('\n')) {
      if (!line.trim()) continue;
      const [kind, size, mtime, nameB64] = line.split('|');
      if (kind === undefined || size === undefined || mtime === undefined || nameB64 === undefined) continue;
      let name: string;
      try {
        name = Buffer.from(nameB64.trim(), 'base64').toString('utf8');
      } catch {
        continue;
      }
      if (RESERVED.has(name)) continue; // internal markers stay invisible
      entries.push({
        name,
        type: kind === 'directory' ? 'dir' : kind === 'regular file' || kind === 'regular empty file' ? 'file' : kind === 'symbolic link' ? 'symlink' : 'other',
        size: Number(size) || 0,
        mtime: Number(mtime) || 0,
      });
    }
    return { path: dir, entries };
  }

  async read(ownerId: string, serverId: string, rel: string | undefined) {
    const { volume } = await this.volumeOf(ownerId, serverId);
    const file = this.sanitizeFile(rel ?? '');
    const script = [
      `f=${this.q(`/data/${file}`)}`,
      `[ -e "$f" ] || [ -L "$f" ] || { echo TROXE_ERR=NOTFOUND; exit 3; }`,
      `r=$(realpath "$f"); case "$r" in /data/*) ;; *) echo TROXE_ERR=ESCAPE; exit 4;; esac`,
      `[ -f "$r" ] || { echo TROXE_ERR=NOTFILE; exit 5; }`,
      `sz=$(stat -c %s "$r");`,
      `if [ "$sz" -gt ${FilesService.READ_MAX} ]; then echo TROXE_ERR=TOOBIG:$sz; exit 6; fi`,
      `base64 -w0 "$r"; echo`,
    ].join('\n');
    const res = await this.helper(volume, script, { ro: true, capture: true, timeoutMs: 30_000 });
    this.throwIfErr(res.out, res.code);
    const buf = Buffer.from(res.out.replace(/\s+/g, ''), 'base64');
    if (buf.includes(0)) throw Err.invalid('FILE_BINARY', 'File is binary — use download instead');
    return { path: file, size: buf.length, content: buf.toString('utf8') };
  }

  async write(ownerId: string, serverId: string, rel: string, content?: string, contentBase64?: string) {
    if ((content === undefined) === (contentBase64 === undefined))
      throw Err.invalid('FILE_BODY', 'Provide exactly one of content / contentBase64');
    // text edits are capped lower; base64 uploads may be real binaries
    const cap = content !== undefined ? FilesService.WRITE_MAX : FilesService.UPLOAD_MAX;
    const buf = content !== undefined ? Buffer.from(content, 'utf8') : Buffer.from(contentBase64!, 'base64');
    if (buf.length > cap)
      throw new AppError('FILE_TOO_LARGE', 413, `File exceeds ${cap} bytes`);
    const release = await this.serversSvc.acquire(serverId);
    try {
      const { volume } = await this.volumeOf(ownerId, serverId);
      const file = this.sanitizeFile(rel);
      const b64 = buf.toString('base64');
      // one giant argv would hit ARG_MAX — stream in 4-char-aligned chunks
      const CHUNK = 500_000 - (500_000 % 4);
      const parts: string[] = [];
      for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));
      // empty content has no chunks — truncate/create the tmp file directly
      // (otherwise mv would fail on a file that was never created)
      const payload = parts.length
        ? parts.map((p, i) => `printf '%s' '${p}' | base64 -d ${i === 0 ? '>' : '>>'} "$f.tmp.$$" || { echo TROXE_ERR=WRITE; exit 5; }`)
        : [`: > "$f.tmp.$$" || { echo TROXE_ERR=WRITE; exit 5; }`];
      const lines = [
        `f=${this.q(`/data/${file}`)}`,
        `d=$(dirname "$f");`,
        // refuse to create through a symlinked ancestor (would land outside /data)
        `c="$d"; while [ "$c" != /data ] && [ "$c" != / ] && [ "$c" != . ]; do`,
        `  [ -L "$c" ] && { echo TROXE_ERR=ESCAPE; exit 4; }; c=$(dirname "$c");`,
        `done;`,
        `mkdir -p "$d";`,
        `r=$(realpath "$d"); case "$r" in /data|/data/*) ;; *) echo TROXE_ERR=ESCAPE; exit 4;; esac`,
        ...payload,
        // mv replaces a symlink itself instead of following it
        `mv -f "$f.tmp.$$" "$f" || { echo TROXE_ERR=WRITE; exit 5; }`,
      ];
      const res = await this.helper(volume, lines.join('\n'), { capture: true, timeoutMs: 60_000 });
      this.throwIfErr(res.out, res.code);
      return { path: file, size: buf.length };
    } finally {
      release();
    }
  }

  async mkdir(ownerId: string, serverId: string, rel: string) {
    const release = await this.serversSvc.acquire(serverId);
    try {
      const { volume } = await this.volumeOf(ownerId, serverId);
      const dir = this.sanitizeFile(rel);
      const script = [
        `p=${this.q(`/data/${dir}`)}`,
        `c="$p"; while [ "$c" != /data ] && [ "$c" != / ] && [ "$c" != . ]; do`,
        `  [ -L "$c" ] && { echo TROXE_ERR=ESCAPE; exit 4; }; c=$(dirname "$c");`,
        `done;`,
        `mkdir -p "$p" || { echo TROXE_ERR=WRITE; exit 5; }`,
        `r=$(realpath "$p"); case "$r" in /data|/data/*) ;; *) echo TROXE_ERR=ESCAPE; exit 4;; esac`,
      ].join('\n');
      const res = await this.helper(volume, script, { capture: true, timeoutMs: 60_000 });
      this.throwIfErr(res.out, res.code);
      return { path: dir };
    } finally {
      release();
    }
  }

  async remove(ownerId: string, serverId: string, rel: string | undefined) {
    const release = await this.serversSvc.acquire(serverId);
    try {
      const { volume } = await this.volumeOf(ownerId, serverId);
      const target = this.sanitizeFile(rel ?? '');
      const script = [
        `f=${this.q(`/data/${target}`)}`,
        `[ -e "$f" ] || [ -L "$f" ] || { echo TROXE_ERR=NOTFOUND; exit 3; }`,
        `r=$(realpath "$f"); case "$r" in /data/*) ;; *) echo TROXE_ERR=ESCAPE; exit 4;; esac`,
        `rm -rf "$r" || { echo TROXE_ERR=WRITE; exit 5; }`,
      ].join('\n');
      const res = await this.helper(volume, script, { capture: true, timeoutMs: 60_000 });
      this.throwIfErr(res.out, res.code);
      return { ok: true, path: target };
    } finally {
      release();
    }
  }

  async rename(ownerId: string, serverId: string, from: string, to: string) {
    const release = await this.serversSvc.acquire(serverId);
    try {
      const { volume } = await this.volumeOf(ownerId, serverId);
      const src = this.sanitizeFile(from);
      const dst = this.sanitizeFile(to);
      if (src === dst) throw Err.invalid('FILE_SAME', 'Source and destination are identical');
      const script = [
        `s=${this.q(`/data/${src}`)}; t=${this.q(`/data/${dst}`)}`,
        `[ -e "$s" ] || [ -L "$s" ] || { echo TROXE_ERR=NOTFOUND; exit 3; }`,
        `r=$(realpath "$s"); case "$r" in /data/*) ;; *) echo TROXE_ERR=ESCAPE; exit 4;; esac`,
        `d=$(dirname "$t");`,
        `c="$d"; while [ "$c" != /data ] && [ "$c" != / ] && [ "$c" != . ]; do`,
        `  [ -L "$c" ] && { echo TROXE_ERR=ESCAPE; exit 4; }; c=$(dirname "$c");`,
        `done;`,
        `mkdir -p "$d";`,
        `rd=$(realpath "$d"); case "$rd" in /data|/data/*) ;; *) echo TROXE_ERR=ESCAPE; exit 4;; esac`,
        `mv -f "$s" "$t" || { echo TROXE_ERR=WRITE; exit 5; }`,
      ].join('\n');
      const res = await this.helper(volume, script, { capture: true, timeoutMs: 60_000 });
      this.throwIfErr(res.out, res.code);
      return { from: src, to: dst };
    } finally {
      release();
    }
  }

  async download(ownerId: string, serverId: string, rel: string | undefined): Promise<{ filename: string; data: Buffer }> {    const { volume } = await this.volumeOf(ownerId, serverId);
    const target = this.sanitizeFile(rel ?? '');
    const base = target.split('/').pop()!;
    const script = [
      `f=${this.q(`/data/${target}`)}`,
      `[ -e "$f" ] || [ -L "$f" ] || { echo TROXE_ERR=NOTFOUND; exit 3; }`,
      `r=$(realpath "$f"); case "$r" in /data/*) ;; *) echo TROXE_ERR=ESCAPE; exit 4;; esac`,
      `sz=$(stat -c %s "$r");`,
      `if [ "$sz" -gt ${FilesService.DOWNLOAD_MAX} ]; then echo TROXE_ERR=TOOBIG:$sz; exit 6; fi`,
      `if [ -d "$r" ]; then tar -czf - -C /data ${this.q(target)} | base64 -w0; echo;`,
      `else base64 -w0 "$r"; echo; fi`,
    ].join('\n');
    const res = await this.helper(volume, script, { ro: true, capture: true, timeoutMs: 120_000, logMaxSize: '12m' });
    this.throwIfErr(res.out, res.code);
    const data = Buffer.from(res.out.replace(/\s+/g, ''), 'base64');
    // `tar -cz` of a directory vs raw file: sniff gzip magic to name it right
    const isDir = data.length > 2 && data[0] === 0x1f && data[1] === 0x8b && (await this.isDir(volume, target));
    return { filename: isDir ? `${base}.tar.gz` : base, data };
  }

  /**
   * Create a .tar.gz from up to 50 sibling paths. All sources and the
   * destination must share one parent dir (keeps `tar -C` exact, no
   * surprises). Symlinks are stored as links, never followed.
   */
  async archive(ownerId: string, serverId: string, sources: string[], dest: string) {
    const release = await this.serversSvc.acquire(serverId);
    try {
      const { volume } = await this.volumeOf(ownerId, serverId);
      const srcs = sources.map((s) => this.sanitizeFile(s));
      const dst = this.sanitizeFile(dest);
      if (!/\.tar\.gz$/.test(dst) && !/\.tgz$/.test(dst))
        throw Err.invalid('FILE_FORMAT', 'Destination must end in .tar.gz or .tgz');
      const parents = new Set([...srcs, dst].map((p) => posix.dirname(p)));
      if (parents.size !== 1)
        throw Err.invalid('FILE_SPLIT', 'All paths must share the same parent directory');
      if (srcs.includes(dst)) throw Err.invalid('FILE_SAME', 'Destination overlaps a source');
      const parent = [...parents][0];
      const bases = srcs.map((s) => posix.basename(s));
      const destBase = posix.basename(dst);
      const script = [
        `p=${this.q(`/data/${parent}`)}`,
        `[ -d "$p" ] || { echo TROXE_ERR=NOTDIR; exit 3; }`,
        `r=$(realpath "$p"); case "$r" in /data|/data/*) ;; *) echo TROXE_ERR=ESCAPE; exit 4;; esac`,
        // every source must exist (tar's own error would be a blind 502)
        ...bases.map((b) => `[ -e "$r"/${this.q(b)} ] || [ -L "$r"/${this.q(b)} ] || { echo TROXE_ERR=NOTFOUND; exit 3; }`),
        // bound helper time: refuse absurd inputs up front
        `total=$(du -sb ${bases.map((b) => this.q(`$r/${b}`)).join(' ')} 2>/dev/null | awk '{s+=$1} END {print s+0}');`,
        `if [ "$total" -gt ${FilesService.ARCHIVE_MAX} ]; then echo TROXE_ERR=TOOBIG:$total; exit 6; fi`,
        `cd "$r" || exit 5;`,
        `tar -czf ${this.q(destBase)} ${bases.map((b) => this.q(b)).join(' ')} || { echo TROXE_ERR=WRITE; exit 5; }`,
      ].join('\n');
      const res = await this.helper(volume, script, { capture: true, timeoutMs: 120_000 });
      this.throwIfErr(res.out, res.code);
      return { path: dst };
    } finally {
      release();
    }
  }

  /**
   * Extract a .zip / .tar.gz / .tgz / .tar into the volume. Every entry is
   * listed and validated FIRST (no absolute paths, no `..`) — tarbomb-proof.
   */
  async extract(ownerId: string, serverId: string, file: string, dest: string | undefined) {
    const release = await this.serversSvc.acquire(serverId);
    try {
      const { volume } = await this.volumeOf(ownerId, serverId);
      const arc = this.sanitizeFile(file);
      const kind = /\.zip$/.test(arc) ? 'zip' : /(\.tar\.gz|\.tgz)$/.test(arc) ? 'targz' : /\.tar$/.test(arc) ? 'tar' : null;
      if (!kind) throw Err.invalid('FILE_FORMAT', 'Only .zip, .tar.gz, .tgz and .tar can be extracted');
      const outDir = dest !== undefined ? this.sanitizeFile(dest) : posix.dirname(arc);
      const script = [
        `f=${this.q(`/data/${arc}`)}`,
        `d=${this.q(`/data/${outDir}`)}`,
        `[ -f "$f" ] || { echo TROXE_ERR=NOTFOUND; exit 3; }`,
        `r=$(realpath "$f"); case "$r" in /data/*) ;; *) echo TROXE_ERR=ESCAPE; exit 4;; esac`,
        `sz=$(stat -c %s "$r");`,
        `if [ "$sz" -gt ${FilesService.ARCHIVE_MAX} ]; then echo TROXE_ERR=TOOBIG:$sz; exit 6; fi`,
        // list + validate every entry BEFORE creating anything (refused
        // extracts leave zero trace).
        // NOTE: the tools themselves sanitize listings AND payloads
        // (busybox tar strips leading '/' and '../'), so this pre-check is
        // defense-in-depth for raw listings; the post-extract sweep below is
        // the real guarantee. Symlink/hardlink members are refused outright
        // (visible as ^l/^h only in verbose tar listings).
        ...(kind === 'zip'
          ? [
              `unzip -l "$r" | sed -n 's/^ *[0-9][0-9]*  *[0-9-]*  *[0-9:]*  //p' > /tmp/troxe_list.txt || { echo TROXE_ERR=WRITE; exit 5; }`,
            ]
          : [
              `tar -t${kind === 'targz' ? 'z' : ''}vf "$r" > /tmp/troxe_verbose.txt || { echo TROXE_ERR=WRITE; exit 5; }`,
              `if grep -q '^[lh]' /tmp/troxe_verbose.txt; then echo TROXE_ERR=ESCAPE; exit 4; fi`,
              `sed -n 's/^\\([^ ][^ ]* *\\)\\{5\\}//p' /tmp/troxe_verbose.txt > /tmp/troxe_list.txt || { echo TROXE_ERR=WRITE; exit 5; }`,
            ]),
        `bad=0; while IFS= read -r e || [ -n "$e" ]; do`,
        `  case "$e" in ""|./|./*) ;; *)`,
        `    case "$e" in /*) bad=1;; esac;`,
        `    case "$e" in */../*|../*|*/..|..) bad=1;; esac;;`,
        `  esac;`,
        `done < /tmp/troxe_list.txt;`,
        `if [ "$bad" -ne 0 ]; then echo TROXE_ERR=ESCAPE; exit 4; fi`,
        // destination must exist without creating through symlinks
        `c="$d"; while [ "$c" != /data ] && [ "$c" != / ] && [ "$c" != . ]; do`,
        `  [ -L "$c" ] && { echo TROXE_ERR=ESCAPE; exit 4; }; c=$(dirname "$c");`,
        `done;`,
        `newdir=0; [ -e "$d" ] || newdir=1;`,
        `mkdir -p "$d";`,
        `rd=$(realpath "$d"); case "$rd" in /data|/data/*) ;; *) echo TROXE_ERR=ESCAPE; exit 4;; esac`,
        ...(kind === 'zip'
          ? [`unzip -o -q "$r" -d "$rd" || { echo TROXE_ERR=WRITE; exit 5; }`]
          : [`tar -x${kind === 'targz' ? 'z' : ''}f "$r" -C "$rd" || { echo TROXE_ERR=WRITE; exit 5; }`]),
        // post-extract sweep: some tools sanitize listings but not payloads —
        // every extracted path must resolve inside the destination
        `total=$(find "$rd" -mindepth 1 2>/dev/null | wc -l);`,
        `ok=$(find "$rd" -mindepth 1 -exec realpath {} + 2>/dev/null | grep -cF "$rd/");`,
        `exact=$(find "$rd" -mindepth 1 -exec realpath {} + 2>/dev/null | grep -cFx "$rd");`,
        `ok=$((ok + exact));`,
        `if [ "$ok" -ne "$total" ]; then`,
        `  if [ "$newdir" -eq 1 ]; then rm -rf "$rd"; fi;`,
        `  echo TROXE_ERR=ESCAPE; exit 4;`,
        `fi`,
      ].join('\n');
      const res = await this.helper(volume, script, { capture: true, timeoutMs: 120_000 });
      this.throwIfErr(res.out, res.code);
      return { dest: outDir };
    } finally {
      release();
    }
  }

  // ---- internals ----------------------------------------------------------

  private async volumeOf(ownerId: string, serverId: string): Promise<{ volume: string }> {
    if (!this.docker.available) throw new AppError('DOCKER_UNAVAILABLE', 503, 'Container runtime is not available');
    const row = await this.serversSvc.requireOwned(ownerId, serverId);
    if (!row.volumeName) throw Err.conflict('SERVER_NOT_PROVISIONED', 'Server has no volume yet');
    return { volume: row.volumeName };
  }

  private async helper(
    volume: string,
    script: string,
    opts: { ro?: boolean; capture?: boolean; timeoutMs?: number; logMaxSize?: string },
  ) {
    return this.docker.runHelper({
      image: config.HELPER_IMAGE,
      cmd: [script],
      binds: [`${volume}:/data:${opts.ro ? 'ro' : 'rw'}`],
      user: '0:0',
      timeoutMs: opts.timeoutMs ?? 60_000,
      memoryMb: 256,
      captureLogs: opts.capture ?? false,
      logMaxSize: opts.logMaxSize,
    });
  }

  private throwIfErr(out: string, code: number): void {
    const m = out.match(/TROXE_ERR=([A-Z]+)(?::(\d+))?/);
    if (!m) {
      if (code !== 0) throw new AppError('FILE_OP_FAILED', 502, 'File operation failed');
      return;
    }
    const [, kind, size] = m;
    switch (kind) {
      case 'NOTFOUND':
        throw Err.notFound('FILE_NOT_FOUND');
      case 'NOTDIR':
        throw Err.invalid('FILE_NOT_DIR', 'Path is not a directory');
      case 'NOTFILE':
        throw Err.invalid('FILE_NOT_FILE', 'Path is not a regular file');
      case 'ESCAPE':
        throw Err.invalid('FILE_ESCAPE', 'Path escapes the server storage');
      case 'TOOBIG':
        throw new AppError('FILE_TOO_LARGE', 413, `File is ${size ?? '?'} bytes — exceeds the limit`);
      case 'WRITE':
        throw new AppError('FILE_OP_FAILED', 502, 'File operation failed');
      default:
        throw new AppError('FILE_OP_FAILED', 502, 'File operation failed');
    }
  }

  /** Lexical containment: normalize and reject anything escaping the root. */
  private sanitizeFile(rel: string): string {
    if (typeof rel !== 'string' || rel.includes('\0')) throw Err.invalid('FILE_PATH', 'Invalid path');
    if (rel.length > 512) throw Err.invalid('FILE_PATH', 'Path too long');
    const norm = posix.normalize(rel.replace(/\\/g, '/'));
    const clean = norm.replace(/^\.\//, '').replace(/^\//, '');
    if (!clean || clean === '.' || clean === '..' || clean.startsWith('../') || clean.includes('/../') || clean.endsWith('/..'))
      throw Err.invalid('FILE_PATH', 'Invalid path');
    const segs = clean.split('/');
    if (segs.length > 32 || segs.some((s) => !s || s.length > 255 || s === '.' || s === '..'))
      throw Err.invalid('FILE_PATH', 'Invalid path');
    if (segs.some((s) => RESERVED.has(s)))
      throw Err.invalid('FILE_RESERVED', 'This name is reserved for the platform');
    return clean;
  }

  private sanitizeDir(rel: string): string {
    if (rel === '' || rel === '/' || rel === '.') return '';
    return this.sanitizeFile(rel);
  }

  /** Single-quote shell escaping (base64 alphabet never contains `'`, paths are quoted regardless). */
  private q(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
  }

  private async isDir(volume: string, target: string): Promise<boolean> {
    const res = await this.helper(volume, `[ -d ${this.q(`/data/${target}`)} ]`, { ro: true, timeoutMs: 15_000 });
    return res.code === 0;
  }
}
