/**
 * Frontend smoke render — no extra dependencies.
 *
 * Bundles test-frontend/entry.jsx with the project's own esbuild and renders
 * every routed page with react-dom/server. Effects never run, so no network
 * calls happen; what we DO catch is exactly the class of bug the build misses:
 * missing imports (`useEffect is not defined`), bad destructuring, components
 * that throw on first paint, undefined hooks, etc.
 *
 *   npm run test:smoke
 *
 * Exit 0 = every page rendered. Exit 1 = at least one page threw.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outFile = path.join(here, '.build', 'smoke-bundle.cjs');

// ---------------------------------------------------------------- DOM stubs
// Modules evaluate at require time and some touch window/document/matchMedia
// during render. Stub generously BEFORE loading the bundle.
const noop = () => {};
const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, setAttribute: noop, appendChild: noop, removeChild: noop, addEventListener: noop, removeEventListener: noop, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }), querySelector: () => null, querySelectorAll: () => [], focus: noop, blur: noop, remove: noop, innerHTML: '' });

const win = {
  location: { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', search: '', hash: '', assign: noop, replace: noop },
  history: { pushState: noop, replaceState: noop, back: noop },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop, clear: noop },
  sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  matchMedia: () => ({ matches: false, media: '', addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false }),
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false,
  scrollTo: noop, scrollX: 0, scrollY: 0, innerWidth: 1440, innerHeight: 900,
  devicePixelRatio: 1, isSecureContext: true, open: noop, close: noop,
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: clearTimeout,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } },
  MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  navigator: { userAgent: 'smoke', language: 'en', onLine: true, clipboard: { writeText: async () => {} } },
  WebSocket: class { constructor() { setTimeout(() => this.onclose?.(), 0); } close() {} send() {} addEventListener() {} },
};

globalThis.window = win;
globalThis.self = win;
for (const k of Object.keys(win)) {
  if (k in globalThis) continue;
  try { globalThis[k] = win[k]; } catch { /* read-only global (e.g. navigator) */ }
}
try { Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true }); } catch { /* keep node's */ }
globalThis.document = {
  title: '', cookie: '', visibilityState: 'visible',
  createElement: el, createElementNS: el, createTextNode: () => ({}),
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener: noop, removeEventListener: noop, body: el(), documentElement: el(),
  head: el(), readyState: 'complete', hidden: false, fonts: { ready: Promise.resolve() },
};
globalThis.Image = class { set src(_) { setTimeout(() => this.onload?.(), 0); } };
globalThis.HTMLCanvasElement = class {};
globalThis.localStorage = win.localStorage;
globalThis.sessionStorage = win.sessionStorage;
globalThis.requestAnimationFrame = win.requestAnimationFrame;
globalThis.cancelAnimationFrame = win.cancelAnimationFrame;

// ------------------------------------------------------------------ bundle
const require_ = createRequire(import.meta.url);
const esbuild = require_(path.join(root, 'node_modules', 'esbuild'));

/** Vite's import.meta.glob is not understood by esbuild — expand it statically. */
const globPlugin = {
  name: 'vite-glob-shim',
  setup(build) {
    build.onLoad({ filter: /\.(js|jsx|mjs|cjs)$/ }, async (args) => {
      if (args.path.includes('node_modules')) return null;
      let src = await fs.promises.readFile(args.path, 'utf8');
      if (!src.includes('import.meta.glob') && !src.includes('import.meta.env')) return null;
      const dir = path.dirname(args.path);
      src = src.replace(/import\.meta\.glob\(\s*(['"`])([^'"`]+)\1\s*(?:,\s*\{[\s\S]*?\})?\s*\)/g, (_m, _q, pattern) => {
        const matches = fs.globSync(pattern, { cwd: dir }).sort();
        return '{' + matches.map((f) => `${JSON.stringify('./' + f)}: ${JSON.stringify(f)}`).join(',') + '}';
      });
      src = src
        .replace(/import\.meta\.env\.DEV\b/g, 'false')
        .replace(/import\.meta\.env\.PROD\b/g, 'true')
        .replace(/import\.meta\.env\.MODE\b/g, '"test"')
        .replace(/import\.meta\.env\.VITE_API_URL\b/g, '"http://127.0.0.1:3300"')
        .replace(/import\.meta\.env\b(?!\.)/g, '{}');
      return { contents: src, loader: path.extname(args.path).slice(1) || 'jsx' };
    });
  },
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const build = await esbuild.build({
  entryPoints: [path.join(here, 'entry.jsx')],
  outfile: outFile,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: false,
  logLevel: 'warning',
  loader: { '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl' },
  plugins: [globPlugin],
  metafile: true,
});
const warnings = build.warnings.filter((w) => !/externalized|empty import.meta|frozen object/.test(w.text));
if (warnings.length) {
  console.log('build warnings:');
  for (const w of warnings) console.log('  -', w.text);
}

// ------------------------------------------------------------------ render
const mod = require_(outFile);
const results = mod.run();

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`ok   - ${r.name} (${r.ms}ms, ${r.html.length} bytes)`);
  } else {
    failed++;
    console.log(`FAIL - ${r.name}: ${r.error}`);
    if (process.env.SMOKE_STACK) console.log(r.stack);
  }
}
console.log('='.repeat(60));
console.log(`rendered: ${results.length - failed}/${results.length}`);
if (failed) {
  console.error(`${failed} page(s) failed to render`);
  process.exit(1);
}
console.log('all pages render');
// timers stubs (rAF) and react-query keep the loop alive — exit explicitly
process.exit(0);
