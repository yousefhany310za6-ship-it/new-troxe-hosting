/**
 * Project detection — what kind of project is sitting in the volume?
 *
 * Two consumers, one source of truth:
 *   1. the catalog schema check, which refuses a template whose expected files
 *      contradict its declared project type;
 *   2. the create-time hint, which tells a client "your volume looks like a
 *      pnpm project" before they pick a template.
 *
 * Pure and file-list based so it is unit-testable with no filesystem and no
 * Docker: the caller passes the names that exist, this decides what they mean.
 */

/** The ecosystems the platform can recognise. */
export type ProjectKind =
  | 'node-npm'
  | 'node-pnpm'
  | 'node-yarn'
  | 'node-bun'
  | 'python-requirements'
  | 'python-pyproject'
  | 'python-poetry'
  | 'python-uv'
  | 'php-composer'
  | 'ruby-bundler'
  | 'go'
  | 'rust'
  | 'java-maven'
  | 'java-gradle'
  | 'dotnet'
  | 'deno'
  | 'unknown';

/**
 * Ordered so the most specific lockfile wins. Order MATTERS: a pnpm project
 * often carries a package.json too, and a Poetry project often has both
 * pyproject.toml and requirements.txt. Checking the lockfile first is what
 * stops "npm install" from quietly producing a second, conflicting tree
 * alongside a pnpm-lock.yaml.
 */
const DETECTORS: Array<{ kind: ProjectKind; all: string[] }> = [
  { kind: 'node-pnpm', all: ['package.json', 'pnpm-lock.yaml'] },
  { kind: 'node-yarn', all: ['package.json', 'yarn.lock'] },
  { kind: 'node-bun', all: ['package.json', 'bun.lockb'] },
  { kind: 'node-npm', all: ['package.json', 'package-lock.json'] },
  { kind: 'node-npm', all: ['package.json'] },
  { kind: 'python-poetry', all: ['pyproject.toml', 'poetry.lock'] },
  { kind: 'python-uv', all: ['pyproject.toml', 'uv.lock'] },
  { kind: 'python-pyproject', all: ['pyproject.toml'] },
  { kind: 'python-requirements', all: ['requirements.txt'] },
  { kind: 'php-composer', all: ['composer.json'] },
  { kind: 'ruby-bundler', all: ['Gemfile'] },
  { kind: 'go', all: ['go.mod'] },
  { kind: 'rust', all: ['Cargo.toml'] },
  { kind: 'java-maven', all: ['pom.xml'] },
  { kind: 'java-gradle', all: ['build.gradle'] },
  { kind: 'java-gradle', all: ['build.gradle.kts'] },
  { kind: 'dotnet', all: ['global.json'] },
  { kind: 'deno', all: ['deno.json'] },
  { kind: 'deno', all: ['deno.jsonc'] },
];

/** What a list of filenames says about the project. `unknown` when empty. */
export function detectProject(fileNames: readonly string[]): ProjectKind {
  // Both sides are case-folded: manifest names are famously mixed-case
  // (Cargo.toml, build.gradle.kts) while a volume uploaded from Windows can
  // carry any casing at all.
  const set = new Set(fileNames.map((n) => n.toLowerCase()));
  for (const d of DETECTORS) {
    if (d.all.every((f) => set.has(f.toLowerCase()))) return d.kind;
  }
  return 'unknown';
}

/** Human label for the UI ("pnpm project", "Python (Poetry)"). */
export const PROJECT_KIND_LABEL: Record<ProjectKind, string> = {
  'node-npm': 'Node.js (npm)',
  'node-pnpm': 'Node.js (pnpm)',
  'node-yarn': 'Node.js (Yarn)',
  'node-bun': 'Node.js (Bun)',
  'python-requirements': 'Python (requirements.txt)',
  'python-pyproject': 'Python (pyproject.toml)',
  'python-poetry': 'Python (Poetry)',
  'python-uv': 'Python (uv)',
  'php-composer': 'PHP (Composer)',
  'ruby-bundler': 'Ruby (Bundler)',
  go: 'Go',
  rust: 'Rust',
  'java-maven': 'Java (Maven)',
  'java-gradle': 'Java (Gradle)',
  dotnet: '.NET',
  deno: 'Deno',
  unknown: 'unrecognised',
};

/**
 * Which project kinds a template can actually serve. The schema check uses this
 * to refuse a template that declares, say, a Composer install but expects no
 * composer.json — the exact class of contradiction that produces a template
 * that "appears in the UI and then does nothing".
 */
export const TEMPLATE_ACCEPTS: Record<string, ProjectKind[]> = {
  'nodejs-npm': ['node-npm', 'node-pnpm', 'node-yarn', 'node-bun'],
  'nodejs-pnpm': ['node-pnpm', 'node-npm'],
  'nodejs-yarn': ['node-yarn', 'node-npm'],
  'nodejs-typescript': ['node-npm', 'node-pnpm', 'node-yarn', 'node-bun'],
  'bot-discord-nodejs': ['node-npm', 'node-pnpm', 'node-yarn', 'node-bun'],
  'bot-telegram-nodejs': ['node-npm', 'node-pnpm', 'node-yarn', 'node-bun'],
  'framework-express': ['node-npm', 'node-pnpm', 'node-yarn', 'node-bun'],
  'framework-fastify': ['node-npm', 'node-pnpm', 'node-yarn', 'node-bun'],
  'framework-nestjs': ['node-npm', 'node-pnpm', 'node-yarn', 'node-bun'],
  'framework-nextjs': ['node-npm', 'node-pnpm', 'node-yarn', 'node-bun'],
  'app-nextjs': ['node-npm', 'node-pnpm', 'node-yarn', 'node-bun'],
  'app-nodejs-worker': ['node-npm', 'node-pnpm', 'node-yarn', 'node-bun'],
  'bun-app': ['node-bun', 'node-npm'],
  'python-pip': ['python-requirements', 'python-pyproject'],
  'python-poetry': ['python-poetry'],
  'python-uv': ['python-uv'],
  'bot-discord-python': ['python-requirements', 'python-pyproject'],
  'bot-telegram-python': ['python-requirements', 'python-pyproject'],
  'framework-flask': ['python-requirements', 'python-pyproject'],
  'framework-fastapi': ['python-requirements', 'python-pyproject'],
  'framework-django': ['python-requirements', 'python-pyproject'],
  'app-python-async': ['python-requirements', 'python-pyproject'],
  'go-app': ['go'],
  'go-http': ['go'],
  'rust-app': ['rust'],
  'java-jar': ['java-maven', 'java-gradle', 'unknown'],
  'java-maven': ['java-maven'],
  'java-gradle': ['java-gradle'],
  'framework-spring-boot': ['java-maven', 'java-gradle'],
  'bot-discord-java': ['java-maven', 'java-gradle', 'unknown'],
  'php-cli': ['php-composer', 'unknown'],
  'php-worker': ['php-composer', 'unknown'],
  'framework-laravel': ['php-composer'],
  'framework-symfony': ['php-composer'],
  'ruby-app': ['ruby-bundler'],
  'framework-sinatra': ['ruby-bundler'],
  'dotnet-app': ['dotnet', 'unknown'],
  'framework-aspnet': ['dotnet', 'unknown'],
  'deno-app': ['deno', 'unknown'],
};

/** True when the detected project is one this template can work with. */
export function templateAccepts(templateId: string, kind: ProjectKind): boolean {
  const accepted = TEMPLATE_ACCEPTS[templateId];
  // A template with no explicit contract accepts anything: a bare `index.js`
  // with no package.json is still a valid Node server.
  if (!accepted) return true;
  return accepted.includes(kind);
}