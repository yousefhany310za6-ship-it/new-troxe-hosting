/**
 * The lifecycle phases of a sandbox, kept separate on purpose.
 *
 * A template that "installed" is NOT a template that "ran", and the platform
 * must never conflate them. Before this module existed the only signal was the
 * container command chaining install && start with a single exit code, so a
 * broken build looked identical to a broken app.
 *
 * Each phase is reported independently so the UI, the admin panel and the test
 * harness can all answer: did dependencies install? did it compile? did the
 * process stay up? Only when install+build+start all succeed does a template
 * earn `verified`, and even that is recorded by the test suite, not by the
 * runtime merely reaching a steady state.
 */
export type LifecyclePhase = 'install' | 'build' | 'startup' | 'health';

export type PhaseStatus = 'pending' | 'ok' | 'failed' | 'skipped' | 'unknown';

export interface PhaseResult {
  phase: LifecyclePhase;
  status: PhaseStatus;
  /** short, client-safe explanation (never secrets, never daemon internals) */
  detail?: string;
  /** epoch ms when the phase settled */
  at?: number;
}

/** The five-level verification state, distinct from the runtime phase state. */
export type VerificationStatus = 'verified' | 'unverified' | 'broken' | 'deprecated' | 'disabled';

/**
 * Build a phase ledger from the markers a template's start log emits.
 *
 * The sandbox's compiled prelude prints stable `[troxe] …` lines. Parsing those
 * (rather than guessing from "process is up") is what lets the platform say
 * "dependencies installed but the build failed" instead of a binary alive/dead.
 */
export function phasesFromLog(log: string, opts?: { startupStayedUp?: boolean }): PhaseResult[] {
  const now = Date.now();
  const results: PhaseResult[] = [];

  const sawInstallOk = /\[troxe\] (npm|pnpm|yarn|bun|pip|poetry|uv|composer|bundle|maven|gradle|deno): (installing|resolving|caching)/i.test(log);
  const sawInstallFail = /\[troxe\] (dependency install|project install|poetry install|uv sync|composer install|bundle install|maven resolve|gradle resolve) FAILED/i.test(log);
  results.push({
    phase: 'install',
    status: sawInstallFail ? 'failed' : sawInstallOk ? 'ok' : 'skipped',
    detail: sawInstallFail ? 'dependency install failed — see the console log' : sawInstallOk ? 'dependencies installed' : 'no dependency step for this project',
    at: sawInstallOk || sawInstallFail ? now : undefined,
  });

  const sawBuildOk = /\[troxe\] building (Go|Rust|TypeScript)|\[troxe\] building \(/i.test(log);
  const sawBuildFail = /\[troxe\] (go build|cargo build|build|TypeScript build|maven|gradle|dotnet) FAILED/i.test(log);
  results.push({
    phase: 'build',
    status: sawBuildFail ? 'failed' : sawBuildOk ? 'ok' : 'skipped',
    detail: sawBuildFail ? 'build failed — the app was not started' : sawBuildOk ? 'build succeeded' : 'no build step for this project',
    at: sawBuildOk || sawBuildFail ? now : undefined,
  });

  const exited = /\[troxe\] Process exited with code (\d+)/.exec(log);
  const stayedUp = opts?.startupStayedUp ?? !exited;
  results.push({
    phase: 'startup',
    status: stayedUp ? 'ok' : 'failed',
    detail: stayedUp
      ? 'process is running'
      : `process exited with code ${exited?.[1] ?? 'unknown'} — see the console log`,
    at: stayedUp ? now : undefined,
  });

  return results;
}

/** Roll the ledger up into one honest status the UI can show in a sentence. */
export function summarizePhases(phases: PhaseResult[]): 'ready' | 'degraded' | 'failed' {
  if (phases.some((p) => p.status === 'failed')) return 'failed';
  if (phases.some((p) => p.status === 'pending' || p.status === 'unknown')) return 'degraded';
  return 'ready';
}