/**
 * Package-manager policy (pure — no Nest/Drizzle imports, unit-testable).
 *
 * The security rule that shapes this module: a package name is the ONLY thing a
 * client controls. It is validated against a per-manager allow-list, passed as
 * a single argv element (never concatenated into a shell string), and executed
 * as one fixed command inside the caller's own container. A name that is not an
 * exact match for the syntax below never reaches the runtime at all.
 */

export type PackageManager = 'npm' | 'bun' | 'pip' | 'go';

/** The manager each runtime is served by. PHP has none in this platform. */
export const MANAGER_FOR_RUNTIME: Record<string, PackageManager | null> = {
  'Node.js': 'npm',
  Bun: 'bun',
  Python: 'pip',
  PHP: null,
};

/**
 * npm/scoped package name, optionally with a version selector
 * (`express`, `@scope/pkg`, `express@4.18.2`, `@scope/pkg@^1.0.0`).
 * No spaces, no shell metacharacters, no leading dashes (no flags).
 */
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[^\s@|;&`$()<>\\"']+)?$/i;

/** PEP 508 normalised name, optionally with a version specifier. */
const PIP_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?(?:[<>=!~]=?[^\s;|;&`$()<>\\"']+)?$/;

/** Go module path, optionally with @version. */
const GO_NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9.-]*[a-z0-9])?)+(\/[^\s@|;&`$()<>\\"']+)?(@[^\s@|;&`$()<>\\"']+)?$/i;

export function isValidPackageName(manager: PackageManager, name: string): boolean {
  if (typeof name !== 'string') return false;
  const value = name.trim();
  if (!value || value.length > 214) return false; // 214 = longest legal registry name
  if (value.startsWith('-')) return false; // never a flag
  switch (manager) {
    case 'npm':
    case 'bun':
      return NPM_NAME.test(value);
    case 'pip':
      return PIP_NAME.test(value);
    case 'go':
      return GO_NAME.test(value);
    default:
      return false;
  }
}

/** The command for one install. argv only — no shell anywhere. */
export function installCommand(manager: PackageManager, name: string): string[] {
  switch (manager) {
    case 'npm':
      return ['npm', 'install', '--no-audit', '--no-fund', '--loglevel', 'error', name];
    case 'bun':
      return ['bun', 'add', name];
    case 'pip':
      return ['pip', 'install', '--user', '--no-input', name];
    case 'go':
      return ['go', 'get', name];
  }
}

/** The command for one removal. */
export function uninstallCommand(manager: PackageManager, name: string): string[] {
  switch (manager) {
    case 'npm':
      return ['npm', 'uninstall', '--no-audit', '--no-fund', '--loglevel', 'error', name];
    case 'bun':
      return ['bun', 'remove', name];
    case 'pip':
      return ['pip', 'uninstall', '--user', '--yes', name];
    case 'go':
      return ['go', 'get', name];
  }
}

/** Human label for a manager, shown in the UI next to the install button. */
export const MANAGER_LABEL: Record<PackageManager, string> = {
  npm: 'npm',
  bun: 'bun',
  pip: 'pip',
  go: 'Go modules',
};

/**
 * A package name as stored/displayed: the bare name without its version
 * selector, so `express@4.18.2` and `express` compare equal.
 */
export function basePackageName(manager: PackageManager, name: string): string {
  const value = name.trim();
  if (manager === 'pip') {
    return value.split(/[<>=!~]/)[0].trim().toLowerCase();
  }
  if (manager === 'npm' || manager === 'bun') {
    // strip the version, but keep the scope separator intact
    const at = value.lastIndexOf('@');
    return at > 0 ? value.slice(0, at) : value;
  }
  // go: strip @version
  const at = value.lastIndexOf('@');
  return at > 0 ? value.slice(0, at) : value;
}

/** How long one package operation may run before it is cut off. */
export const PACKAGE_OP_TIMEOUT_MS = 180_000;

/** Per-server ceiling on package operations (abuse control). */
export const PACKAGE_OPS_PER_HOUR = 30;
