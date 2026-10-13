/**
 * Runtime image allowlist.
 *
 * A client can only ever run one of these images — never an arbitrary image
 * from the registry (that would be remote code execution on the host's Docker
 * daemon with root-equivalent pull rights).
 *
 * Node.js uses the Debian (glibc) slim variants, NOT alpine/musl: native npm
 * addons (canvas, better-sqlite3, sharp, @napi-rs/*, bcrypt…) ship prebuilt
 * glibc binaries. On musl there is no prebuild, the sandbox has no
 * Python/make/g++ to compile one, and the install fails. Verified: canvas@3,
 * @napi-rs/canvas and better-sqlite3 all install and load on bookworm-slim.
 *
 * Images are pinned by DIGEST (`name@sha256:...`), never by mutable tag: a
 * republished tag (upstream rebuild, registry compromise) must not change
 * the bytes we execute — as root in helpers, as uid 1000 in sandboxes.
 *
 * Rotation runbook: `docker pull <tag>` → read `.RepoDigests[0]` →
 * replace the digest below → rebuild + full suite. Never accept a digest
 * over an insecure channel; verify against the upstream release notes.
 *
 * `user` is a numeric uid/gid: every sandbox runs as an unprivileged user
 * even if a future image drops its own non-root account.
 */
import type { Starter } from './starter';

export type Runtime =
  | 'Node.js'
  | 'Python'
  | 'Bun'
  | 'PHP'
  | 'Go'
  | 'Rust'
  | 'Java'
  | 'Ruby'
  | '.NET'
  | 'Deno';

/** One selectable version of a runtime (egg-style `docker_images` entry). */
export interface RuntimeVersion {
  /** stable selector, e.g. '20' — what the API accepts */
  version: string;
  /** human display label, e.g. 'Node.js 20' */
  label: string;
  /** pinned, allowlisted digest ref (see rotation runbook above) */
  image: string;
}

/**
 * Retired digests and their replacements.
 *
 * A server row stores the digest it was provisioned with (`runtime_version`).
 * When a pinned image is rotated, rows still referencing the old digest must
 * not be bricked: provisioning maps a retired digest to its successor instead
 * of refusing with IMAGE_NOT_ALLOWED, and the row is then updated to the new
 * digest so the mapping is a one-time migration, not a permanent shrug.
 *
 * Rotation runbook: add the old digest here pointing at its replacement in the
 * SAME commit that changes the pinned image above.
 */
export const RETIRED_IMAGES: Readonly<Record<string, string>> = Object.freeze({
  // the original alpine images: native npm addons ship prebuilt GLIBC binaries
  // only, and musl cannot build them in a sandbox with no toolchain
  'node@sha256:bf77dc26e48ea95fca9d1aceb5acfa69d2e546b765ec2abfb502975f1a2d4def':
    'node@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0',
  'node@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd':
    'node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392',
  // the first glibc pins: better-sqlite3@13 ships a prebuilt binary for that
  // exact Node patch which segfaults on open (on both distros), so rows move to
  // the newer patch of the same major line
  'node@sha256:357deca6eb61149534d32faaf5e4b2e4fa3549c2be610ee1019bf340ea8c51ec':
    'node@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0',
  'node@sha256:35531c52ce27b6575d69755c73e65d4468dba93a25644eed56dc12879cae9213':
    'node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392',
});

/** True when the digest is one this platform may run right now. */
export function isAllowlistedImage(runtime: RuntimeImage, image: string): boolean {
  return runtime.versions.some((v) => v.image === image);
}

/**
 * Resolve the image a server should be provisioned with: the requested digest
 * when it is still allowlisted, its documented successor when it has been
 * retired, and the runtime default as a last resort (never an error — a stale
 * row must still boot).
 */
export function resolveRuntimeImage(runtime: RuntimeImage, requested: string | undefined): string {
  if (requested && isAllowlistedImage(runtime, requested)) return requested;
  if (requested) {
    const successor = RETIRED_IMAGES[requested];
    if (successor && isAllowlistedImage(runtime, successor)) return successor;
  }
  return runtime.image;
}

/** Egg-style startup variable (cf. Pterodactyl `variables[]`). */
export interface EggVariable {
  /** env key, e.g. MAIN_FILE */
  key: string;
  /** human name shown in the form */
  name: string;
  description: string;
  defaultValue: string;
  required: boolean;
}

export interface RuntimeImage {
  runtime: Runtime;
  /** pinned, allowlisted digest ref (see rotation runbook above) */
  image: string;
  /** human display label — digests must never reach the UI */
  label: string;
  /** selectable versions; [0] is the default */
  versions: RuntimeVersion[];
  /** egg-style variables, injected as env defaults and usable as {{KEY}} */
  variables: EggVariable[];
  /** uid:gid inside the container (never 0) */
  user: string;
  /** working directory = the client's persistent volume */
  workdir: string;
  port: number;
  /** baseline env for this runtime (client env is applied on top) */
  env: Record<string, string>;
  /** fallback startup when the client did not provide one */
  defaultStartup: string;
  /**
   * File seeded into a volume that holds NO client files yet, so a brand-new
   * server boots to `online` instead of `Process crashed` on an empty /data.
   * Never written when anything else is present — the client's files win.
   */
  starter?: Starter;
  /**
   * A compilable starter PROJECT (Go, Rust): several files that build into a
   * runnable binary on an empty volume. Same guarantee as `starter` — written
   * only while /data holds nothing but our marker, never over client files.
   */
  starterFiles?: Starter[];
}

/**
 * Starter files.
 *
 * They LISTEN on `process.env.PORT`, and that is the entire point.
 *
 * The previous starter only printed a line and slept. Docker published the
 * allocated host port, the database held the allocation, the panel showed a
 * green "Allocated" and a copyable address — and every one of those connections
 * was reset, because nothing inside the container had ever called `listen()`.
 * A brand-new server therefore looked healthy and was completely unreachable,
 * while the platform blamed the customer's code for a fault the platform itself
 * had written.
 *
 * A starter that actually listens makes the whole path prove itself the moment
 * the server comes up: host port -> docker binding -> container socket -> HTTP
 * 200. If THAT fails, something is genuinely broken and the panel says so
 * instead of showing a green badge. Written only while the volume holds no
 * client files — it never overwrites anything the customer uploaded.
 */
const JS_STARTER = [
  '// Troxe starter — replace this with your own code.',
  '// It only listens so you can confirm the published port works.',
  'const http = require("http");',
  'const port = Number(process.env.PORT) || 3000;',
  '',
  'http',
  '  .createServer((req, res) => {',
  '    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });',
  '    res.end("Troxe starter is running on container port " + port + "\\n");',
  '  })',
  '  .listen(port, "0.0.0.0", () => {',
  '    console.log("[troxe] listening on " + port + " (published as " + (process.env.SERVER_PORT || "?") + ")");',
  '  });',
  '',
  '// Keep the process alive so the container stays up while you edit.',
  'setInterval(() => {}, 1 << 30);',
  '',
].join('\n');

const PY_STARTER = [
  '# Troxe starter — replace this with your own code.',
  '# It only listens so you can confirm the published port works.',
  'import http.server',
  'import os',
  '',
  'PORT = int(os.environ.get("PORT", "8000"))',
  '',
  '',
  'class Handler(http.server.BaseHTTPRequestHandler):',
  '    def do_GET(self):',
  '        body = f"Troxe starter is running on container port {PORT}.\\n".encode()',
  '        self.send_response(200)',
  '        self.send_header("content-type", "text/plain; charset=utf-8")',
  '        self.send_header("content-length", str(len(body)))',
  '        self.end_headers()',
  '        self.wfile.write(body)',
  '',
  '    def log_message(self, fmt, *a):',
  '        print("[troxe] " + (fmt % a), flush=True)',
  '',
  '',
  'print(f"[troxe] listening on {PORT}", flush=True)',
  'http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()',
  '',
].join('\n');

const PHP_STARTER = [
  '<?php',
  '// Troxe starter — replace this with your own code.',
  '// It only listens so you can confirm the published port works.',
  '$port = (int) (getenv("PORT") ?: 8080);',
  'echo "[troxe] listening on {$port}\\n";',
  '',
  '$server = @stream_socket_server("tcp://0.0.0.0:{$port}", $errno, $errstr);',
  'if (!$server) {',
  '    fwrite(STDERR, "[troxe] could not listen: {$errstr} ({$errno})\\n");',
  '    exit(1);',
  '}',
  '',
  'while (true) {',
  '    $client = @stream_socket_accept($server, -1);',
  '    if ($client) {',
  '        $body = "Troxe starter is running on container port {$port}.\\n";',
  '        fwrite($client, "HTTP/1.1 200 OK\\r\\nContent-Type: text/plain; charset=utf-8\\r\\n"',
  '            . "Content-Length: " . strlen($body) . "\\r\\nConnection: close\\r\\n\\r\\n" . $body);',
  '        fclose($client);',
  '    }',
  '}',
  '',
].join('\n');

const GO_STARTER = [
  'package main',
  '',
  'import (',
  '\t"fmt"',
  '\t"net/http"',
  '\t"os"',
  ')',
  '',
  'func main() {',
  '\tport := os.Getenv("PORT")',
  '\tif port == "" {',
  '\t\tport = "8080"',
  '\t}',
  '\tfmt.Println("[troxe] listening on " + port)',
  '\thttp.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {',
  '\t\tfmt.Fprintf(w, "Troxe starter is running on container port %s.\\n", port)',
  '\t})',
  '\tif err := http.ListenAndServe("0.0.0.0:"+port, nil); err != nil {',
  '\t\tpanic(err)',
  '\t}',
  '}',
  '',
].join('\n');

const RUST_CARGO_STARTER = [
  '[package]',
  'name = "server"',
  'version = "0.1.0"',
  'edition = "2021"',
  '',
  '[dependencies]',
  '',
].join('\n');

const RUST_MAIN_STARTER = [
  '// Troxe starter — replace this with your own code.',
  '// It only listens so you can confirm the published port works.',
  'use std::io::{Read, Write};',
  'use std::net::TcpListener;',
  '',
  'fn main() {',
  '    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());',
  '    let addr = format!("0.0.0.0:{}", port);',
  '    let listener = TcpListener::bind(&addr).expect("bind failed");',
  '    println!("[troxe] listening on {}", port);',
  '    for stream in listener.incoming() {',
  '        let mut s = match stream {',
  '            Ok(s) => s,',
  '            Err(_) => continue,',
  '        };',
  '        let body = format!("Troxe starter is running on container port {}.\\n", port);',
  '        let _ = s.write_all(',
  '            format!("HTTP/1.1 200 OK\\r\\nContent-Length: {}\\r\\nConnection: close\\r\\n\\r\\n{}", body.len(), body)',
  '                .as_bytes(),',
  '        );',
  '        let _ = (&s).read(&mut [0u8; 1]);',
  '    }',
  '}',
  '',
].join('\n');

const RUBY_STARTER = [
  '# Troxe starter — replace this with your own code.',
  '# It only listens so you can confirm the published port works.',
  'require "socket"',
  '',
  'port = ENV.fetch("PORT", "8080")',
  'server = TCPServer.new("0.0.0.0", port.to_i)',
  'puts "[troxe] listening on #{port}"',
  '',
  'loop do',
  '  client = server.accept',
  '  body = "Troxe starter is running on container port #{port}.\\n"',
  '  client.print("HTTP/1.1 200 OK\\r\\nContent-Type: text/plain\\r\\n" \\',
  '              "Content-Length: #{body.bytesize}\\r\\nConnection: close\\r\\n\\r\\n#{body}")',
  '  client.close',
  'end',
  '',
].join('\n');

const DENO_STARTER = [
  '// Troxe starter — replace this with your own code.',
  '// It only listens so you can confirm the published port works.',
  'const port = Number(Deno.env.get("PORT") ?? 8000);',
  'console.log(`[troxe] listening on ${port}`);',
  'Deno.serve({ port, hostname: "0.0.0.0" }, () =>',
  '  new Response(`Troxe starter is running on container port ${port}.\\n`));',
  '',
].join('\n');

export const RUNTIME_IMAGES: Record<Runtime, RuntimeImage> = {
  'Node.js': {
    runtime: 'Node.js',
    image: 'node@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0', // node:20-bookworm-slim (20.20)
    label: 'Node.js 20',
    versions: [
      {
        version: '20',
        label: 'Node.js 20',
        image: 'node@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0', // node:20-bookworm-slim (20.20)
      },
      {
        version: '22',
        label: 'Node.js 22',
        image: 'node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392', // node:22-bookworm-slim (22.23)
      },
      {
        version: '24',
        label: 'Node.js 24 (LTS)',
        image: 'node@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20', // node:24-bookworm-slim
      },
      {
        version: '26',
        label: 'Node.js 26',
        image: 'node@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567', // node:26-bookworm-slim
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Main file', description: 'The file that starts the app.', defaultValue: 'index.js', required: true },
      { key: 'NODE_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to node.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 3000,
    env: {
      HOME: '/data',
      NODE_ENV: 'production',
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      NPM_CONFIG_FUND: 'false',
      NPM_CONFIG_AUDIT: 'false',
    },
    starter: { path: 'index.js', content: JS_STARTER },
    defaultStartup: 'node {{MAIN_FILE}} {{NODE_ARGS}}',
  },
  Python: {
    runtime: 'Python',
    image: 'python@sha256:e41613d42d4891e4930f79523f93f81bbc7632584ec65e36ab055f41a800b41e', // python:3.11-slim
    label: 'Python 3.11',
    versions: [
      {
        version: '3.11',
        label: 'Python 3.11',
        image: 'python@sha256:e41613d42d4891e4930f79523f93f81bbc7632584ec65e36ab055f41a800b41e', // python:3.11-slim
      },
      {
        version: '3.12',
        label: 'Python 3.12',
        image: 'python@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f', // python:3.12-slim
      },
      {
        version: '3.13',
        label: 'Python 3.13',
        image: 'python@sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641', // python:3.13-slim-bookworm
      },
      {
        version: '3.14',
        label: 'Python 3.14',
        image: 'python@sha256:48b13b003dda20b16f9442b8475aa05fe21bf6579a8c881db92ffb4d8fd20f83', // python:3.14-slim-bookworm
      },
      {
        version: '3.15',
        label: 'Python 3.15',
        image: 'python@sha256:122756f3fe72c4f5d3d71897888204ee85774bc79de952555b8a474e1d0a5d53', // python:3.15-slim-bookworm
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Main file', description: 'The file that starts the app.', defaultValue: 'main.py', required: true },
      { key: 'PY_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to python.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 8000,
    env: {
      HOME: '/data',
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      PIP_NO_CACHE_DIR: '1',
    },
    starter: { path: 'main.py', content: PY_STARTER },
    defaultStartup: 'python {{MAIN_FILE}} {{PY_ARGS}}',
  },
  Bun: {
    runtime: 'Bun',
    image: 'oven/bun@sha256:29cebde0efcd19be4b1e1592d73cd21ccba93c1448b1cec172584738d74b7b80', // oven/bun:1.2.4
    label: 'Bun 1.2',
    versions: [
      {
        version: '1.2',
        label: 'Bun 1.2',
        image: 'oven/bun@sha256:29cebde0efcd19be4b1e1592d73cd21ccba93c1448b1cec172584738d74b7b80', // oven/bun:1.2.4
      },
      {
        version: '1.3',
        label: 'Bun 1.3',
        image: 'oven/bun@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f', // oven/bun:1.3-debian
      },
      {
        version: '1.4',
        label: 'Bun 1.4',
        image: 'oven/bun@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b', // oven/bun:1.4-debian
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Main file', description: 'The file that starts the app.', defaultValue: 'index.js', required: true },
      { key: 'BUN_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to bun.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 3000,
    env: { HOME: '/data', NODE_ENV: 'production' },
    starter: { path: 'index.js', content: JS_STARTER },
    defaultStartup: 'bun run {{MAIN_FILE}} {{BUN_ARGS}}',
  },
  PHP: {
    runtime: 'PHP',
    image: 'php@sha256:f1ed6d1fd0aa769ab94ca307b9deaf55fbc18434315b70e319cd79078515cd2b', // php:8.3-cli
    label: 'PHP 8.3',
    versions: [
      {
        version: '8.3',
        label: 'PHP 8.3',
        image: 'php@sha256:f1ed6d1fd0aa769ab94ca307b9deaf55fbc18434315b70e319cd79078515cd2b', // php:8.3-cli
      },
      {
        version: '8.4',
        label: 'PHP 8.4',
        image: 'php@sha256:836ac6c672d1372a47c8fd61b625015bd07760f493fb2eaab2087636498a2b4b', // php:8.4-cli-bookworm
      },
      {
        version: '8.5',
        label: 'PHP 8.5',
        image: 'php@sha256:819080ed413631f6ec564184dd9acd08d9425bd863b9f8b5876b5ea2147d55e7', // php:8.5-cli-bookworm
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Main file', description: 'The file that starts the app.', defaultValue: 'index.php', required: true },
      { key: 'PHP_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to php.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 8080,
    env: { HOME: '/data' },
    starter: { path: 'index.php', content: PHP_STARTER },
    defaultStartup: 'php {{MAIN_FILE}} {{PHP_ARGS}}',
  },
  Go: {
    runtime: 'Go',
    image: 'golang@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61', // golang:1.27-bookworm
    label: 'Go 1.27',
    versions: [
      {
        version: '1.27',
        label: 'Go 1.27',
        image: 'golang@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61', // golang:1.27-bookworm
      },
      {
        version: '1.26',
        label: 'Go 1.26',
        image: 'golang@sha256:d9c68c2c51161e12fd77e4c6320687c9cd86e1af1e3ad6e6cd63ff970641453c', // golang:1.26-bookworm
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Binary name', description: 'The compiled binary to run (built from go.mod).', defaultValue: 'server', required: true },
      { key: 'GO_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to the binary.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 8080,
    env: { HOME: '/data', GOFLAGS: '-buildvcs=false' },
    // Two files, so the starter seeds a compilable project rather than a bare
    // snippet: `go build` must succeed on a brand-new volume or the first
    // start would fail for a reason that has nothing to do with the client.
    starterFiles: [
      { path: 'go.mod', content: 'module troxe-starter\n\ngo 1.21\n' },
      { path: 'main.go', content: GO_STARTER },
    ],
    defaultStartup: '/data/{{MAIN_FILE}} {{GO_ARGS}}',
  },
  Rust: {
    runtime: 'Rust',
    image: 'rust@sha256:114c7a4425406451c2866b6aafe69fe29b1b298832db1277d411ac73c82d04d6', // rust:1.99-bookworm
    label: 'Rust 1.99',
    versions: [
      {
        version: '1.99',
        label: 'Rust 1.99',
        image: 'rust@sha256:114c7a4425406451c2866b6aafe69fe29b1b298832db1277d411ac73c82d04d6', // rust:1.99-bookworm
      },
      {
        version: '1.98',
        label: 'Rust 1.98',
        image: 'rust@sha256:93ce27a88655056a51dbdd8f5f2d7ddc071c7b0070fb288a37b5a285fc83971e', // rust:1.98-bookworm
      },
      {
        version: '1.97',
        label: 'Rust 1.97',
        image: 'rust@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97', // rust:1.97-bookworm
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Binary name', description: 'The compiled binary in target/release to run.', defaultValue: 'server', required: true },
      { key: 'CARGO_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to the binary.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 8080,
    env: { HOME: '/data', CARGO_TERM_COLOR: 'never' },
    starterFiles: [
      { path: 'Cargo.toml', content: RUST_CARGO_STARTER },
      { path: 'src/main.rs', content: RUST_MAIN_STARTER },
    ],
    defaultStartup: '/data/target/release/{{MAIN_FILE}} {{CARGO_ARGS}}',
  },
  Java: {
    runtime: 'Java',
    image: 'eclipse-temurin@sha256:b468c3fc688b14450571494f588bd939378e7fd542ed5a73f8efc13f17872a87', // eclipse-temurin:21-jdk-noble
    label: 'Java 21',
    versions: [
      {
        version: '21',
        label: 'Java 21 (LTS)',
        image: 'eclipse-temurin@sha256:b468c3fc688b14450571494f588bd939378e7fd542ed5a73f8efc13f17872a87', // eclipse-temurin:21-jdk-noble
      },
      {
        version: '17',
        label: 'Java 17 (LTS)',
        image: 'eclipse-temurin@sha256:fb79620c3f6ee8f1c7530a8dc4fd49e3b410bcef037694ad4858a1553bac4170', // eclipse-temurin:17-jdk-noble
      },
      {
        version: '25',
        label: 'Java 25',
        image: 'eclipse-temurin@sha256:589ff4cc3f71aab462e7048a47a0d10edf57fbccde3fceea2281e610bf5880b4', // eclipse-temurin:25-jdk-noble
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'JAR file', description: 'The .jar file to run.', defaultValue: 'app.jar', required: true },
      { key: 'JAVA_ARGS', name: 'JVM arguments', description: 'Extra arguments passed to java (e.g. -Xmx512m).', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 8080,
    env: { HOME: '/data' },
    defaultStartup: 'java -jar {{MAIN_FILE}} {{JAVA_ARGS}}',
  },
  Ruby: {
    runtime: 'Ruby',
    image: 'ruby@sha256:ba6a00593739f9cb66de80ad2e395a93a52a13635867ee32918ba0ec083b1ff6', // ruby:4.0-slim
    label: 'Ruby 4.0',
    versions: [
      {
        version: '4.0',
        label: 'Ruby 4.0',
        image: 'ruby@sha256:ba6a00593739f9cb66de80ad2e395a93a52a13635867ee32918ba0ec083b1ff6', // ruby:4.0-slim
      },
      {
        version: '3.4',
        label: 'Ruby 3.4',
        image: 'ruby@sha256:c12225b6a73743f943530d9e610f4ae78e0dbcffdcf797b01522a55f7d25acb3', // ruby:3.4-slim
      },
      {
        version: '3.3',
        label: 'Ruby 3.3',
        image: 'ruby@sha256:47b93492bc6afc708dc4f2478c7f1867725c64b3bf43b94ea1bad2dac0314f02', // ruby:3.3-slim
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Main file', description: 'The ruby file that starts the app.', defaultValue: 'main.rb', required: true },
      { key: 'RUBY_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to ruby.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 8080,
    env: { HOME: '/data', BUNDLE_PATH: '/data/.bundle' },
    starter: { path: 'main.rb', content: RUBY_STARTER },
    defaultStartup: 'ruby {{MAIN_FILE}} {{RUBY_ARGS}}',
  },
  '.NET': {
    runtime: '.NET',
    image: 'mcr.microsoft.com/dotnet/sdk@sha256:1330d3c4144aec2695036a125d9a3b49a1fc555c9024c981248fa83d40fa8b23', // dotnet/sdk:9.0-bookworm-slim
    label: '.NET 9',
    versions: [
      {
        version: '9',
        label: '.NET 9',
        image: 'mcr.microsoft.com/dotnet/sdk@sha256:1330d3c4144aec2695036a125d9a3b49a1fc555c9024c981248fa83d40fa8b23', // dotnet/sdk:9.0-bookworm-slim
      },
      {
        version: '8',
        label: '.NET 8 (LTS)',
        image: 'mcr.microsoft.com/dotnet/sdk@sha256:ec9c0a0dc5f60adc2065762050638dd5ed5facfc53716d4580a42d86027c8e80', // dotnet/sdk:8.0-bookworm-slim
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'DLL name', description: 'The published .dll to run.', defaultValue: 'app.dll', required: true },
      { key: 'DOTNET_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to the app.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 8080,
    env: { HOME: '/data', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1' },
    defaultStartup: 'dotnet /data/publish/{{MAIN_FILE}} {{DOTNET_ARGS}}',
  },
  Deno: {
    runtime: 'Deno',
    image: 'denoland/deno@sha256:fa335acdf6b72106eda2cb6a8cb5f4187e7630e357467489db4b2e7352d5e432', // denoland/deno:debian-2.9.7
    label: 'Deno 2.9',
    versions: [
      {
        version: '2.9',
        label: 'Deno 2.9',
        image: 'denoland/deno@sha256:fa335acdf6b72106eda2cb6a8cb5f4187e7630e357467489db4b2e7352d5e432', // denoland/deno:debian-2.9.7
      },
      {
        version: '2.8',
        label: 'Deno 2.8',
        image: 'denoland/deno@sha256:438618d8c0678c3154fc77ad6edad61f38cbc42803a181e7908d3e2c9e645022', // denoland/deno:debian-2.8.3
      },
      {
        version: '2.7',
        label: 'Deno 2.7',
        image: 'denoland/deno@sha256:564e989f4a93371e70fd8720e5dbe3e027fd4a0daad71a2b008008596ffa6492', // denoland/deno:debian-2.7.14
      },
    ],
    variables: [
      { key: 'MAIN_FILE', name: 'Main file', description: 'The .ts/.js file that starts the app.', defaultValue: 'main.ts', required: true },
      { key: 'DENO_ARGS', name: 'Additional arguments', description: 'Extra arguments passed to deno.', defaultValue: '', required: false },
    ],
    user: '1000:1000',
    workdir: '/data',
    port: 8000,
    // DENO_DIR must live on the volume: the default is inside the image, which
    // is read-only, so a cache there would make every start fail.
    env: { HOME: '/data', DENO_NO_UPDATE_CHECK: '1', DENO_DIR: '/data/.deno' },
    starter: { path: 'main.ts', content: DENO_STARTER },
    defaultStartup: 'deno run --allow-net --allow-env --allow-read --allow-write {{MAIN_FILE}} {{DENO_ARGS}}',
  },
};

export const RUNTIMES = Object.keys(RUNTIME_IMAGES) as Runtime[];

export function runtimeImage(runtime: string): RuntimeImage {
  const img = RUNTIME_IMAGES[runtime as Runtime];
  if (!img) throw new Error(`unsupported runtime: ${runtime}`);
  return img;
}

/** Resolve a version selector to its pinned entry (default = versions[0]). */
export function resolveVersion(runtime: string, version?: string): RuntimeVersion {
  const img = runtimeImage(runtime);
  if (!version) return img.versions[0];
  const v = img.versions.find((x) => x.version === version);
  if (!v) throw new Error(`unsupported version: ${version} (allowed: ${img.versions.map((x) => x.version).join(', ')})`);
  return v;
}

/** Display label for a stored digest — never leaks the digest itself. */
export function labelFor(runtime: string, digest: string | null): string {
  const img = runtimeImage(runtime);
  return img.versions.find((v) => v.image === digest)?.label ?? img.label;
}

/** Merge egg variable defaults under explicit user env (user wins). */
export function resolveEggEnv(runtime: string, userEnv: { k: string; v: string }[]): { k: string; v: string }[] {
  const img = runtimeImage(runtime);
  const seen = new Set(userEnv.map((e) => e.k));
  const out = [...userEnv];
  for (const v of img.variables) {
    if (!seen.has(v.key)) out.push({ k: v.key, v: v.defaultValue });
  }
  return out;
}

const TEMPLATE_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

/**
 * Substitute `{{VAR}}` placeholders in a startup command from the merged
 * env. Unknown variables fail fast (typos would otherwise boot silently
 * wrong). Values are shell-quoted when they contain unsafe characters.
 */
export function applyTemplate(startup: string, env: { k: string; v: string }[]): string {
  const map = new Map(env.map((e) => [e.k, e.v]));
  return startup.replace(TEMPLATE_RE, (m, key: string) => {
    if (!map.has(key)) throw new Error(`unknown startup variable: {{${key}}}`);
    const v = map.get(key)!;
    return /[^A-Za-z0-9_@%+=:,./-]/.test(v) ? `'${v.replace(/'/g, `'\\''`)}'` : v;
  });
}
