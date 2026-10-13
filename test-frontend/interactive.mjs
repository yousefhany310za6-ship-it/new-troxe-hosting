/**
 * Interactive click-through test.
 *
 * The smoke test renders every page once with react-dom/server: it catches
 * missing imports and crashes on first paint, but it never runs effects, never
 * fetches, and never clicks. That is exactly the blind spot that let two real
 * bugs ship:
 *
 *   1. a button that rendered the FolderTree COMPONENT where the icon was
 *      meant — the whole Files tab crashed the moment it mounted;
 *   2. the Schedules tab hiding "New schedule" from the owner, because /grant
 *      returns [] for owners while the UI checks permission keys.
 *
 * This harness mounts the real ServerDetail page in jsdom with a fetch stub
 * shaped like production, clicks the tabs and the share form, and fails on any
 * escaped error or missing control. Run: npm run test:interactive
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
// Which page to drive. Both harnesses share this jsdom + esbuild setup rather
// than duplicating ~150 lines of DOM stubs, so adding a third page is one arg.
const entry = process.argv[2] || 'interactive-entry.jsx';
const outFile = path.join(here, '.build', entry.replace(/\.jsx$/, '') + '-bundle.cjs');
const require_ = createRequire(import.meta.url);

// ------------------------------------------------------------ DOM stubs
const noop = () => {};
const el = () => ({
  style: {},
  classList: { add: noop, remove: noop, toggle: noop },
  setAttribute: noop,
  appendChild: noop,
  removeChild: noop,
  addEventListener: noop,
  removeEventListener: noop,
  getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
  querySelector: () => null,
  querySelectorAll: () => [],
  focus: noop,
  blur: noop,
  remove: noop,
  innerHTML: '',
});

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/dashboard/servers/srv-1',
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
try {
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
} catch {
  /* keep node's */
}
for (const k of [
  'Element', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'DOMParser', 'Window',
]) {
  if (k in window) {
    try {
      globalThis[k] = window[k];
    } catch {
      /* read-only global */
    }
  }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia =
  window.matchMedia ||
  (() => ({ matches: false, media: '', addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false }));
window.HTMLElement.prototype.scrollTo = noop;
window.scrollTo = noop;

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
        .replace(/import\.meta\.env\.VITE_API_URL\b/g, '"/api/v1"')
        .replace(/import\.meta\.env\b(?!\.)/g, '{}');
      return { contents: src, loader: path.extname(args.path).slice(1) || 'jsx' };
    });
  },
};

const esbuild = require_('esbuild');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
await esbuild.build({
  entryPoints: [path.join(here, entry)],
  outfile: outFile,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  logLevel: 'warning',
  loader: { '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl' },
  plugins: [globPlugin],
});

const mod = require_(outFile);
const { results, consoleErrors } = await mod.run({ window, document: window.document });

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`ok   - ${r.name}`);
  else {
    failed++;
    console.log(`FAIL - ${r.name}: ${r.error}`);
  }
}
if (consoleErrors?.length) {
  console.log('\nescaped console errors:');
  for (const e of [...new Set(consoleErrors)].slice(0, 10)) console.log('  *', String(e).slice(0, 300));
}
console.log(`\n${entry.replace(/\.jsx$/, '')}: ${results.length - failed}/${results.length} checks passed`);
if (failed || consoleErrors?.length) process.exitCode = 1;
