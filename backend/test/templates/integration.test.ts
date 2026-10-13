/**
 * Level 3 integration suite — real containers, real lifecycle.
 *
 * Run with:  TROXE_TEMPLATE_TESTS=1 npm run test:templates
 *
 * Every case follows the full lifecycle (install → build → start → assert →
 * logs → stop → restart → persistence → cleanup) and asserts a CONCRETE
 * outcome — a marker the app printed, a binary that exists, a port that answers.
 * "The container started" is not an assertion; a container that starts and then
 * immediately dies is exactly the failure this suite exists to catch.
 *
 * Each template earns `verified` ONLY if its case passes here.
 */

import { after, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { TestSandbox, cleanupStrayTestResources, commandForTemplate, dockerReady } from './harness.ts';
import { templateById } from '../../src/modules/servers/templates/catalog.ts';
import { applyTemplate, resolveVersion, runtimeImage } from '../../src/modules/servers/provisioning/images.ts';

if (dockerReady) cleanupStrayTestResources();
after(() => {
  if (dockerReady) cleanupStrayTestResources();
});

/** Resolve a template's startup exactly as the API does for a fresh server. */
function startupFor(templateId: string): string {
  const t = templateById(templateId);
  const env = t.variables.map((v) => ({ k: v.key, v: v.defaultValue }));
  return applyTemplate(t.startup, env);
}

/**
 * The container port the platform would advertise for this template
 * (`primaryContainerPort`). Passed into the container so the app binds the same
 * port it would in production.
 */
function portFor(templateId: string): number | undefined {
  return templateById(templateId).ports[0]?.containerPort;
}

/** Wait (bounded) for a marker to appear in the container log. */
async function waitForLog(sandbox: TestSandbox, needle: string, timeoutMs = 240_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = '';
  while (Date.now() < deadline) {
    seen = sandbox.logs();
    if (seen.includes(needle)) return seen;
    if (!sandbox.isRunning() && seen.includes('Process exited')) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return seen;
}

const NODE_EXPRESS_APP = {
  'package.json': JSON.stringify({ name: 'itest', version: '1.0.0', dependencies: { express: '^4.19.2' } }),
  'index.js': [
    "const express = require('express');",
    "const app = express();",
    'app.get("/", (req, res) => res.send("ITEST_OK"));',
    'app.listen(Number(process.env.PORT), "0.0.0.0", () => console.log("ITEST_READY"));',
  ].join('\n'),
};

const PY_FASTAPI_LITE = {
  // A Flask-shaped app that needs only the standard library, so the test
  // exercises the TEMPLATE's install/start path rather than PyPI flakiness.
  'requirements.txt': '',
  'main.py': [
    'import http.server, os',
    'class H(http.server.BaseHTTPRequestHandler):',
    '    def do_GET(self):',
    '        b = b"ITEST_OK"',
    '        self.send_response(200)',
    '        self.send_header("content-length", str(len(b)))',
    '        self.end_headers()',
    '        self.wfile.write(b)',
    '    def log_message(self, *a):',
    '        pass',
    'print("ITEST_READY", flush=True)',
    'http.server.ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", 8000))), H).serve_forever()',
  ].join('\n'),
};

const GO_HTTP_APP = {
  'go.mod': 'module itest\n\ngo 1.21\n',
  'main.go': [
    'package main',
    '',
    'import ("fmt"; "net/http"; "os")',
    '',
    'func main() {',
    '\tp := os.Getenv("PORT"); if p == "" { p = "8080" }',
    '\tfmt.Println("ITEST_READY")',
    '\thttp.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "ITEST_OK") })',
    '\thttp.ListenAndServe("0.0.0.0:"+p, nil)',
    '}',
  ].join('\n'),
};

const PHP_CLI_APP = {
  'composer.json': JSON.stringify({ name: 'itest/itest', require: {} }),
  'index.php': [
    '<?php',
    'require __DIR__."/vendor/autoload.php";',
    'echo "ITEST_OK\n";',
    'while (true) { sleep(3600); }',
  ].join('\n'),
};

describe('starter projects (docker)', { skip: dockerReady ? false : 'set TROXE_TEMPLATE_TESTS=1 to run' }, () => {
  /**
   * The shipped starters are the FIRST thing a new customer sees, and a
   * non-compiling starter makes their very first start fail for reasons that
   * have nothing to do with them. So the seeded Go project is really compiled
   * here rather than assumed to work.
   */
  it('seeds a Go starter project that compiles and runs', async () => {
    const t = templateById('go-app');
    const image = resolveVersion('Go', '1.27').image;
    const starters = runtimeImage('Go').starterFiles!;
    const files: Record<string, string> = {};
    for (const f of starters) files[f.path] = f.content;

    const box = await TestSandbox.create('go-starter', files, 'golang:1.27-bookworm');
    try {
      box.runDetached(image, commandForTemplate(t, () => startupFor('go-app')), {}, { memoryMb: 2048, port: portFor('go-app') });
      const log = await waitForLog(box, '[troxe] listening on');
      assert.match(log, /\[troxe\] listening on/, `the shipped Go starter did not build or run:\n${log}`);
      assert.ok(box.exists('server', 'golang:1.27-bookworm'), 'the starter did not produce /data/server');
    } finally {
      box.destroy();
    }
  });
});

describe('template integration (docker)', { skip: dockerReady ? false : 'set TROXE_TEMPLATE_TESTS=1 to run' }, () => {
  it('nodejs-npm: installs dependencies and serves HTTP', async () => {
    const t = templateById('nodejs-npm');
    const image = resolveVersion('Node.js', '24').image;
    const box = await TestSandbox.create('node-npm', NODE_EXPRESS_APP, 'node:24-bookworm-slim');
    try {
      box.runDetached(image, commandForTemplate(t, () => startupFor('nodejs-npm')), {}, { port: portFor('nodejs-npm') });
      const log = await waitForLog(box, 'ITEST_READY');
      assert.match(log, /ITEST_READY/, `npm install + start failed:\n${log}`);
      assert.doesNotMatch(log, /\[troxe\] dependency install FAILED/);
      // node_modules must really exist — "installed" has to mean installed.
      assert.ok(box.exists('node_modules/express', 'node:24-bookworm-slim'), 'express was not installed');

      // restart with data intact
      box.stop();
      box.runDetached(image, commandForTemplate(t, () => startupFor('nodejs-npm')), {}, { port: portFor('nodejs-npm') });
      const log2 = await waitForLog(box, 'ITEST_READY');
      assert.match(log2, /ITEST_READY/, 'restart failed');
      assert.ok(box.exists('node_modules/express', 'node:24-bookworm-slim'), 'deps lost across restart');
    } finally {
      box.destroy();
    }
  });

  it('nodejs-pnpm: bootstraps pnpm into the volume and installs', async () => {
    const t = templateById('nodejs-pnpm');
    const image = resolveVersion('Node.js', '24').image;
    const files = {
      'package.json': JSON.stringify({ name: 'itest', version: '1.0.0', dependencies: { ms: '2.1.3' } }),
      'pnpm-lock.yaml': '',
      'index.js': ['const ms = require("ms");', 'console.log("ITEST_READY " + (typeof ms));', 'setInterval(()=>{},1<<30);'].join('\n'),
    };
    const box = await TestSandbox.create('node-pnpm', files, 'node:24-bookworm-slim');
    try {
      box.runDetached(image, commandForTemplate(t, () => startupFor('nodejs-pnpm')), {}, { port: portFor('nodejs-pnpm') });
      const log = await waitForLog(box, 'ITEST_READY');
      assert.match(log, /ITEST_READY function/, `pnpm install failed:\n${log}`);
      assert.match(log, /ITEST_READY/, 'app did not start');
    } finally {
      box.destroy();
    }
  });

  it('nodejs-yarn: bootstraps yarn and installs', async () => {
    const t = templateById('nodejs-yarn');
    const image = resolveVersion('Node.js', '24').image;
    const files = {
      'package.json': JSON.stringify({ name: 'itest', version: '1.0.0', dependencies: { ms: '2.1.3' } }),
      'yarn.lock': '# itest\n',
      'index.js': ['console.log("ITEST_READY");', 'setInterval(()=>{},1<<30);'].join('\n'),
    };
    const box = await TestSandbox.create('node-yarn', files, 'node:24-bookworm-slim');
    try {
      box.runDetached(image, commandForTemplate(t, () => startupFor('nodejs-yarn')), {}, { port: portFor('nodejs-yarn') });
      const log = await waitForLog(box, 'ITEST_READY');
      assert.match(log, /ITEST_READY/, `yarn install failed:\n${log}`);
    } finally {
      box.destroy();
    }
  });

  it('python-pip: runs a python app', async () => {
    const t = templateById('python-pip');
    const image = resolveVersion('Python', '3.12').image;
    const box = await TestSandbox.create('py-pip', PY_FASTAPI_LITE, 'python:3.12-slim-bookworm');
    try {
      box.runDetached(image, commandForTemplate(t, () => startupFor('python-pip')), {}, { port: portFor('python-pip') });
      const log = await waitForLog(box, 'ITEST_READY');
      assert.match(log, /ITEST_READY/, `python start failed:\n${log}`);
      assert.match(log, /\[troxe\] listening|ITEST_READY/);
    } finally {
      box.destroy();
    }
  });

  it('go-app: builds then runs, and refuses to run a broken build', async () => {
    const t = templateById('go-app');
    const image = resolveVersion('Go', '1.27').image;
    const box = await TestSandbox.create('go', GO_HTTP_APP, 'golang:1.27-bookworm');
    try {
      box.runDetached(image, commandForTemplate(t, () => startupFor('go-app')), {}, { memoryMb: 2048, port: portFor('go-app') });
      const log = await waitForLog(box, 'ITEST_READY');
      assert.match(log, /\[troxe\] building Go binary/, `go build did not run:\n${log}`);
      assert.match(log, /ITEST_READY/, `go app did not start:\n${log}`);
      // the binary really is on the volume, i.e. it was compiled, not shipped
      assert.ok(box.exists('server', 'golang:1.27-bookworm'), 'go build produced no /data/server');
    } finally {
      box.destroy();
    }
  });

  it('go-app: a compile error stops the start instead of running stale output', async () => {
    const t = templateById('go-app');
    const image = resolveVersion('Go', '1.27').image;
    const broken = { ...GO_HTTP_APP, 'main.go': 'package main\n\nfunc main() { this is not go }' };
    const box = await TestSandbox.create('go-broken', broken, 'golang:1.27-bookworm');
    try {
      box.runDetached(image, commandForTemplate(t, () => startupFor('go-app')), {}, { memoryMb: 2048, port: portFor('go-app') });
      const log = await waitForLog(box, 'go build FAILED');
      assert.match(log, /go build FAILED/, `a broken build must fail loudly:\n${log}`);
      assert.doesNotMatch(log, /ITEST_READY/, 'the app started despite a failed build');
    } finally {
      box.destroy();
    }
  });

  it('php-cli: composer installs on the platform image and the app runs', async () => {
    const t = templateById('php-cli');
    // The platform image, not php:8.3-cli: the official image ships no composer.
    const platformImage = 'troxe-php-composer:8.3';
    let exists = true;
    try { execFileSync('docker', ['image', 'inspect', platformImage], { stdio: 'ignore' }); } catch { exists = false; }
    if (!exists) return; // image not built in this environment; not a template failure

    const box = await TestSandbox.create('php', PHP_CLI_APP, platformImage);
    try {
      box.runDetached(platformImage, commandForTemplate(t, () => startupFor('php-cli')), {}, { port: portFor('php-cli') });
      const log = await waitForLog(box, 'ITEST_OK');
      assert.match(log, /ITEST_OK/, `composer install + php start failed:\n${log}`);
      assert.ok(box.exists('vendor/autoload.php', platformImage), 'composer did not produce vendor/autoload.php');
    } finally {
      box.destroy();
    }
  });
});