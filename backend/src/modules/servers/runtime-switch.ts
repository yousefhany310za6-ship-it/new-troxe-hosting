/**
 * Runtime-switch policy (pure — no Nest/Drizzle imports, unit-testable).
 *
 * Changing runtime is the most destructive "settings" action a user can take:
 * it swaps the image the container runs, and with it the language, the package
 * manager and the whole dependency tree. The rules here decide what may be
 * carried across, what must be re-derived, and what must be warned about.
 */

import { RUNTIMES, runtimeImage, type Runtime } from './provisioning/images';

/** The variables that belong to the runtime machinery, not to the user. */
const RUNTIME_VARS: Record<string, string[]> = {
  'Node.js': ['MAIN_FILE', 'NODE_ARGS'],
  Bun: ['MAIN_FILE', 'BUN_ARGS'],
  Python: ['MAIN_FILE', 'PY_ARGS'],
  PHP: ['MAIN_FILE', 'PHP_ARGS'],
};

/** File extensions each runtime's entry point is expected to use. */
const RUNTIME_EXTENSIONS: Record<string, string[]> = {
  'Node.js': ['.js', '.mjs', '.cjs', '.ts'],
  Bun: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'],
  Python: ['.py'],
  PHP: ['.php'],
};

/** Extension → the runtimes that could plausibly run it. */
export function extensionMatchesRuntime(mainFile: string | null | undefined, runtime: string): boolean | null {
  if (!mainFile) return null; // nothing to check
  const ext = mainFile.includes('.') ? mainFile.slice(mainFile.lastIndexOf('.')).toLowerCase() : '';
  const allowed = RUNTIME_EXTENSIONS[runtime];
  if (!allowed) return null;
  return allowed.includes(ext);
}

/**
 * The variables that survive a runtime change. Everything the user put there
 * for THEIR code (secrets, tokens, feature flags) is kept; only the previous
 * runtime's mechanical variables are dropped, because they mean nothing under
 * the new one (NODE_ARGS under Python is not a setting, it is a lie).
 */
export function migrateEnvForRuntime(input: {
  env: Array<{ k: string; v: string }>;
  fromRuntime: string;
  toRuntime: string;
}): Array<{ k: string; v: string }> {
  if (input.fromRuntime === input.toRuntime) return input.env;
  const drop = new Set(RUNTIME_VARS[input.fromRuntime] ?? []);
  return input.env.filter((e) => !drop.has(e.k));
}

/** The default entry point for a runtime (its egg default). */
export function defaultMainFile(runtime: string): string {
  const variable = runtimeImage(runtime as Runtime).variables.find((v) => v.key === 'MAIN_FILE');
  return variable?.defaultValue ?? 'index.js';
}

/** The recommended startup command for a runtime. */
export function recommendedStartup(runtime: string): string {
  return runtimeImage(runtime as Runtime).defaultStartup;
}

/**
 * Warnings a user must see before the change is applied. Honest and specific:
 * an empty array means "nothing detectable will break".
 */
export function runtimeChangeWarnings(input: {
  fromRuntime: string;
  toRuntime: string;
  mainFile: string | null;
  mainFileExists: boolean | null;
  hasDependencies: boolean;
}): string[] {
  const warnings: string[] = [];
  if (input.fromRuntime === input.toRuntime) {
    return ['This server already runs on that runtime — only the version changes.'];
  }
  const match = extensionMatchesRuntime(input.mainFile, input.toRuntime);
  if (input.mainFile && match === false) {
    const suggested = defaultMainFile(input.toRuntime);
    warnings.push(
      `Your main file "${input.mainFile}" is not a ${input.toRuntime} entry point. The default for ${input.toRuntime} is "${suggested}" — set it in Server settings after the switch.`,
    );
  }
  if (input.mainFile && input.mainFileExists === false) {
    warnings.push(`"${input.mainFile}" was not found in the server directory. Create it, or set a different main file, or the server will exit on start.`);
  }
  if (input.hasDependencies) {
    warnings.push(`Dependencies installed for ${input.fromRuntime} will not run under ${input.toRuntime} — install the ones you need from the Packages tab.`);
  }
  return warnings;
}

/** Version selectors a client may ask for, straight from the allowlist. */
export function availableVersions(runtime: string): Array<{ version: string; label: string }> {
  return runtimeImage(runtime as Runtime).versions.map((v) => ({ version: v.version, label: v.label }));
}

export { RUNTIMES };
