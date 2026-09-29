/**
 * Where index.html is served from, detected at runtime from the entry bundle:
 * Vite emits `<script src="./assets/index-*.js">` (and `/src/main.jsx` in dev),
 * so the app root is the parent of the bundle's own directory. Works at a domain
 * root and inside a subfolder without hard-coding a base path.
 */
const entry = [...document.querySelectorAll('script[src]')]
    .map((script) => script.src)
    .filter((src) => /\/(assets|src)\//.test(src))
    .at(-1);

export const APP_BASE = entry ? new URL('../', entry).pathname : '/';
