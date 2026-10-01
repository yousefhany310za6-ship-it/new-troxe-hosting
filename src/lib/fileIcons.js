/**
 * File icons vendored from vscode-material-icon-theme
 * (https://github.com/material-extensions/vscode-material-icon-theme,
 * MIT © Philipp Kief) — bundled locally so the file browser never depends
 * on a CDN. Folders keep lucide icons (the theme generates its folder set
 * at build time; no static default exists upstream).
 */

const mods = import.meta.glob('../assets/file-icons/*.svg', { eager: true, as: 'url' });
const byName = Object.fromEntries(
  Object.entries(mods).map(([p, url]) => [p.split('/').pop().replace(/\.svg$/, ''), url]),
);

const pick = (...names) => {
  for (const n of names) if (byName[n]) return byName[n];
  return byName.document;
};

/** filename (lowercased) → icon */
const FILES = {
  'package.json': 'nodejs',
  'package-lock.json': 'nodejs',
  'composer.json': 'php',
  'dockerfile': 'docker',
  '.dockerignore': 'docker',
  'makefile': 'makefile',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.editorconfig': 'editorconfig',
  'license': 'license',
  'readme.md': 'readme',
  'tsconfig.json': 'tsconfig',
  'vite.config.js': 'vite',
  'vite.config.ts': 'vite',
  'webpack.config.js': 'webpack',
};

/** extension (lowercased, no dot) → icon */
const EXTS = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'react',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'react_ts',
  vue: 'vue',
  py: 'python', pyw: 'python',
  php: 'php',
  html: 'html', htm: 'html',
  css: 'css',
  scss: 'sass', sass: 'sass', less: 'less',
  json: 'json', jsonc: 'json', json5: 'json',
  md: 'markdown', mdx: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml',
  sh: 'console', bash: 'console', zsh: 'console', ps1: 'powershell',
  env: 'settings',
  log: 'log', logs: 'log',
  lock: 'lock',
  sql: 'database', db: 'database', sqlite: 'database', sqlite3: 'database',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', ico: 'image', bmp: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio',
  pdf: 'pdf',
  zip: 'zip', tar: 'zip', gz: 'zip', tgz: 'zip', rar: 'zip', '7z': 'zip',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', eot: 'font',
  key: 'key', pem: 'certificate', crt: 'certificate', cer: 'certificate',
  txt: 'document', csv: 'document', ini: 'document', cfg: 'document', conf: 'document',
};

/** Resolve a material icon URL for a file entry (null for directories). */
export function fileIcon(name, type) {
  if (type && type !== 'file') return null;
  const lower = (name ?? '').toLowerCase();
  if (FILES[lower]) return pick(FILES[lower]);
  const dot = lower.lastIndexOf('.');
  // dotfiles like .env / .gitignore have no "extension"
  if (dot <= 0) {
    if (lower === '.env' || lower.startsWith('.env.')) return pick('settings');
    return pick('document');
  }
  // compound: foo.tar.gz → gz (zip icon); foo.d.ts → ts
  const ext = lower.slice(dot + 1);
  if (EXTS[ext]) return pick(EXTS[ext]);
  return pick('document');
}
