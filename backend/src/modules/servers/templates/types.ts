/**
 * Template definitions — the unified catalog schema.
 *
 * A "template" is the user-facing unit ("Discord bot", "FastAPI", "Minecraft
 * Java"), while a "runtime" stays what it always was: an allowlisted Docker
 * image with pinned versions. The template LIVES ON TOP of a runtime and never
 * introduces an image of its own — every image it can run already passes
 * through `RUNTIME_IMAGES` + `resolveVersion()`, so the allowlist that
 * protects the host keeps protecting it no matter how many templates exist.
 *
 * Why the indirection exists: until now `Runtime` WAS the template, so the
 * platform could offer exactly one Node.js flavour. Two Node.js templates
 * (a bot and a web app) are only expressible once the catalog entry is
 * separate from the image list.
 *
 * Security stance, and it is deliberate: nothing in this file is executable.
 * Install/build work is expressed as DECLARATIVE steps (see `steps.ts`) that a
 * fixed compiler turns into shell, using constant literals. No user input and
 * no client-controllable value is ever concatenated into a command — the same
 * invariant `package-policy.ts` already enforces for the Packages tab.
 */

/** Lifecycle stage a step belongs to. Kept separate so the UI can tell
 *  "dependencies installed" apart from "it actually compiled" and "it ran". */
export type StepPhase = 'install' | 'build';

/** The five states a template can be in. `verified` is earned by tests. */
export type TemplateStatus =
  /** its defined verification suite passed on real infrastructure */
  | 'verified'
  /** no test has actually run it yet */
  | 'unverified'
  /** a test ran and failed */
  | 'broken'
  /** still runnable, but no longer recommended (e.g. an EOL runtime) */
  | 'deprecated'
  /** hidden from creation entirely */
  | 'disabled';

export type TemplateCategory =
  | 'application'
  | 'bot'
  | 'language'
  | 'framework'
  | 'game'
  | 'other';

/**
 * A dependency step. `kind` selects the manager; the compiler owns every
 * argument. `detect` lets one template accept several project layouts and let
 * the FIRST one present on disk win — which is how pnpm/yarn/npm coexist in a
 * single Node.js template without the user picking a manager up front.
 */
export type InstallStep =
  | { kind: 'npm'; detect?: string[]; mode?: 'install' | 'ci' }
  | { kind: 'pnpm'; detect?: string[]; mode?: 'install' | 'frozen' }
  | { kind: 'yarn'; detect?: string[]; mode?: 'install' | 'immutable' }
  | { kind: 'bun'; detect?: string[] }
  | { kind: 'pip'; detect?: string[]; from: 'requirements.txt' }
  | { kind: 'pip-project'; detect?: string[] }      // pyproject.toml
  | { kind: 'poetry'; detect?: string[] }
  | { kind: 'uv'; detect?: string[] }
  | { kind: 'composer'; detect?: string[] }
  | { kind: 'bundle'; detect?: string[] }            // Gemfile
  | { kind: 'deno-cache'; detect?: string[]; optional?: true } // best-effort
  | { kind: 'maven'; detect?: string[] }
  | { kind: 'gradle'; detect?: string[] }
  | { kind: 'none' };

/** A compile step. Runs AFTER install and BEFORE the startup command. */
export type BuildStep =
  | { kind: 'tsc'; detect?: string[] }               // honour scripts.build first
  | { kind: 'npm-script'; script: string; detect?: string[] }
  | { kind: 'pnpm-script'; script: string; detect?: string[] }
  | { kind: 'yarn-script'; script: string; detect?: string[] }
  | { kind: 'go-build'; detect?: string[] }
  | { kind: 'cargo-build'; detect?: string[] }
  | { kind: 'maven-package'; detect?: string[] }
  | { kind: 'gradle-build'; detect?: string[] }
  | { kind: 'dotnet-publish'; detect?: string[] }
  | { kind: 'none' };

/** One port a workload publishes. The platform allows at most one TCP and one
 *  UDP per server (see the partial unique index in schema.ts), so a template
 *  declares at most one of each — asserted in the schema check, not by hope. */
export interface TemplatePort {
  protocol: 'tcp' | 'udp';
  /** the port the process binds INSIDE the sandbox (PORT/HOST are set to it) */
  containerPort: number;
  /** shown to the client; also decides whether a port is allocated at all */
  description: string;
  /**
   * The app may never bind this, and that is NOT a fault.
   *
   * A bot is the motivating case: it dials out and nothing comes in, so a
   * dashboard is optional — but plenty of bots DO ship one, and without a
   * published port there would be no way to ever reach it.
   *
   * So the port is still allocated and published (a dashboard must be
   * reachable), but silence on it is reported as information rather than as
   * "your app has to bind this before anything can connect". Only a REQUIRED
   * port that nothing binds is treated as a real problem.
   */
  optional?: boolean;
}

export interface TemplateResources {
  cpuMilli: number;
  ramMb: number;
  storageGb: number;
}

/** Egg-style variable, injected as an env default and usable as {{KEY}}. */
export interface TemplateVariable {
  key: string;
  name: string;
  description: string;
  defaultValue: string;
  required: boolean;
  /** when set, only these values are accepted (validated in the DTO) */
  enumValues?: string[];
}

export interface TemplateDefinition {
  /** stable id; stored on the server row once a template is chosen */
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** the allowlisted image family this template runs on */
  runtime: string;
  /** version selectors valid for THIS template (subset of the runtime's) */
  versions: string[];
  language?: string;
  ports: TemplatePort[];
  install: InstallStep[];
  build: BuildStep[];
  /** command with {{VAR}} placeholders — the only user-visible command text */
  startup: string;
  variables: TemplateVariable[];
  env?: Record<string, string>;
  recommended: TemplateResources;
  /** advisory floor; never enforced as a hard quota (plans decide that) */
  minimum?: TemplateResources;
  /** files that identify a project of this kind, for detection + docs */
  expectedFiles: string[];
  /** official documentation for this workload */
  docs: string;
  status: TemplateStatus;
  /** a disabled template is hidden from creation but still resolvable, so
   *  servers already running on it are never bricked by a later disable */
  enabled: boolean;
  /** the legacy runtime-only template this one supersedes, if any */
  supersedes?: string;
  /** why it is deprecated/broken — surfaced verbatim in the admin panel */
  note?: string;
}