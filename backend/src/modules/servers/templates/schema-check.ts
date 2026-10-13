/**
 * Catalog schema validation — the test that keeps the catalog honest.
 *
 * A template catalog drifts into fiction quickly: a startup that references a
 * variable nobody defines, a version selector the runtime does not have, a
 * Docker image typo, two templates sharing an id. None of that shows up at
 * runtime — it shows up as a client who paid for a server that never boots.
 *
 * So the catalog is validated at BUILD time by `test/unit/templates.test.ts`,
 * not discovered later by users. Everything here is pure so the checks run in
 * milliseconds with no Docker and no database.
 */

import { RUNTIME_IMAGES, RUNTIME_IMAGES as IMAGES } from '../provisioning/images';
import { TEMPLATES, TEMPLATE_BY_ID } from './catalog';
import { compileInstallPrelude, compileBuildPrelude, shq } from './steps';
import type { TemplateDefinition } from './types';

export interface SchemaIssue {
  templateId: string;
  severity: 'error' | 'warning';
  message: string;
}

const VALID_STATUSES = new Set(['verified', 'unverified', 'broken', 'deprecated', 'disabled']);
const VALID_CATEGORIES = new Set(['application', 'bot', 'language', 'framework', 'game', 'other']);
const VAR_RE = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

/** `${VAR}` in a startup command is filled by the container env, not by an egg variable. */
const SHELL_VAR_RE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;

function placeholders(s: string): string[] {
  return [...s.matchAll(VAR_RE)].map((m) => m[1]!);
}

function checkTemplate(t: TemplateDefinition, issues: SchemaIssue[]): void {
  const add = (severity: SchemaIssue['severity'], message: string) =>
    issues.push({ templateId: t.id, severity, message });

  // --- identity ------------------------------------------------------------
  if (!/^[a-z0-9][a-z0-9-]{2,47}$/.test(t.id)) add('error', `id "${t.id}" must be kebab-case, 3-48 chars`);
  if (!t.name?.trim()) add('error', 'name is required');
  if (!t.description?.trim()) add('error', 'description is required');
  if (!VALID_CATEGORIES.has(t.category)) add('error', `unknown category "${t.category}"`);
  if (!VALID_STATUSES.has(t.status)) add('error', `unknown status "${t.status}"`);

  // --- runtime + versions --------------------------------------------------
  const runtime = IMAGES[t.runtime as keyof typeof IMAGES];
  if (!runtime) {
    add('error', `references runtime "${t.runtime}" which is not in RUNTIME_IMAGES`);
    return; // further checks would just repeat the same error
  }
  if (!t.versions.length) add('error', 'declares no versions');
  for (const v of t.versions) {
    if (!runtime.versions.some((rv) => rv.version === v)) {
      add('error', `version "${v}" does not exist for runtime ${t.runtime} (has ${runtime.versions.map((x) => x.version).join(', ')})`);
    }
  }
  if (t.versions.length && runtime.versions[0] && !t.versions.includes(runtime.versions[0].version)) {
    add('warning', 'does not offer the runtime default version');
  }

  // --- startup command -----------------------------------------------------
  if (!t.startup?.trim()) {
    add('error', 'startup command is empty');
  } else {
    if (/\n/.test(t.startup)) add('error', 'startup must be a single line');
    if (t.startup.length > 500) add('error', 'startup exceeds the 500-char API limit');
    const declared = new Set(t.variables.map((v) => v.key));
    for (const key of placeholders(t.startup)) {
      if (!declared.has(key)) add('error', `startup uses {{${key}}} but no variable defines it`);
    }
    // `${VAR}` placeholders are resolved by the container env, so they must not
    // collide with an egg variable of the same name — that silently wins.
    for (const m of t.startup.matchAll(SHELL_VAR_RE)) {
      const name = m[1]!;
      if (declared.has(name)) {
        add('error', `startup uses \${${name}} which collides with the variable of the same name`);
      }
      if (!['PORT', 'SERVER_PORT', 'HOST', 'HOME', 'NODE_ENV', 'PHP_CLI_SERVER_WORKERS', 'PATH'].includes(name)) {
        add('warning', `startup references \${${name}} which the platform does not set`);
      }
    }
  }

  // --- variables -----------------------------------------------------------
  const seenVars = new Set<string>();
  for (const v of t.variables) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(v.key)) add('error', `variable key "${v.key}" must be SCREAMING_SNAKE`);
    if (seenVars.has(v.key)) add('error', `duplicate variable "${v.key}"`);
    seenVars.add(v.key);
    if (!v.name?.trim()) add('error', `variable ${v.key} has no name`);
    if (v.defaultValue === undefined) add('error', `variable ${v.key} has no defaultValue`);
    if (v.defaultValue.length > 200) add('error', `variable ${v.key} default is too long`);
    if (v.enumValues?.length && !v.enumValues.includes(v.defaultValue)) {
      add('error', `variable ${v.key} default "${v.defaultValue}" is not one of its enumValues`);
    }
    // MAIN_FILE must be a relative path: it is interpolated into a shell
    // command, and a leading slash or `..` would read outside the volume.
    if (v.key === 'MAIN_FILE' && v.defaultValue) {
      if (v.defaultValue.startsWith('/')) add('error', 'MAIN_FILE default must be relative');
      if (v.defaultValue.includes('..')) add('error', 'MAIN_FILE default must not contain ".."');
    }
  }

  // --- ports ---------------------------------------------------------------
  // One TCP and one UDP is the hard ceiling (partial unique index on
  // (server_id, protocol) WHERE state='allocated'). Two TCP ports means two
  // servers' worth of allocation for one app, and the second INSERT is
  // refused by the database — a failure the client would never understand.
  const tcp = t.ports.filter((p) => p.protocol === 'tcp');
  const udp = t.ports.filter((p) => p.protocol === 'udp');
  if (tcp.length > 1) add('error', 'declares more than one TCP port (platform allows one)');
  if (udp.length > 1) add('error', 'declares more than one UDP port (platform allows one)');
  for (const p of t.ports) {
    if (!Number.isInteger(p.containerPort) || p.containerPort < 1 || p.containerPort > 65535) {
      add('error', `invalid containerPort ${p.containerPort}`);
    }
    if (!p.description?.trim()) add('error', 'every port needs a description for the create form');
    if (p.containerPort < 1024) add('error', `containerPort ${p.containerPort} is privileged; sandboxes never bind ports below 1024`);
  }
  // The app is told PORT/HOST for the container port; the startup should use it.
  if (t.ports.length && !t.startup.includes('${PORT}') && !t.startup.includes('{{MAIN_FILE}}')) {
    add('warning', 'publishes a port but never binds PORT — the client will not know where to listen');
  }

  // --- steps ---------------------------------------------------------------
  const installShell = compileInstallPrelude(t.install);
  const buildShell = compileBuildPrelude(t.build);
  for (const [label, shell] of [['install', installShell], ['build', buildShell]] as const) {
    if (/\$\{/.test(shell)) add('error', `${label} prelude interpolates a shell variable — steps must be constant`);
    // Backgrounding check, with redirections removed first: `2>&1` contains a
    // single `&` and is obviously not a background. Everything else that leaves
    // one lone `&` really is a background and would let a start race ahead of
    // its own install.
    const withoutRedirection = shell.replace(/\d*>&?\d*/g, '');
    if (/(?<![&])&(?![&])/.test(withoutRedirection)) {
      add('error', `${label} prelude backgrounds a command`);
    }
  }
  // The invariant that actually matters: a MANDATORY step must fail loudly.
  // "Dependencies installed" silently becoming "we tried" is how an app boots
  // against a half-installed tree and dies with MODULE_NOT_FOUND at 3am.
  // `optional` steps (deno cache) are exempt — and must NOT abort the start.
  const mandatory = [...t.install, ...t.build].filter(
    (s) => !('optional' in s && s.optional) && s.kind !== 'none',
  );
  if (mandatory.length) {
    const combined = `${installShell}; ${buildShell}`;
    if (!combined.includes('exit 1')) {
      add('error', 'has mandatory install/build steps but no failure path — a failed install would still start the app');
    }
  }

  // --- resources -----------------------------------------------------------
  const { cpuMilli, ramMb, storageGb } = t.recommended;
  if (cpuMilli < 100) add('error', `recommended cpuMilli ${cpuMilli} is below the platform floor of 100`);
  if (ramMb < 128) add('error', `recommended ramMb ${ramMb} is below the platform floor of 128`);
  if (storageGb < 1) add('error', `recommended storageGb ${storageGb} is below the platform floor of 1`);
  if (t.minimum) {
    if (t.minimum.cpuMilli > cpuMilli) add('error', 'minimum cpu exceeds recommended');
    if (t.minimum.ramMb > ramMb) add('error', 'minimum ram exceeds recommended');
    if (t.minimum.storageGb > storageGb) add('error', 'minimum storage exceeds recommended');
    // The floor must also fit inside the platform's hard maxima, otherwise the
    // template advertises a minimum no plan could ever grant.
    if (t.minimum.ramMb > 24576) add('error', 'minimum ram exceeds the platform maximum');
  }

  // --- docs ----------------------------------------------------------------
  if (!/^https:\/\/[^\s]+$/.test(t.docs)) add('error', `docs "${t.docs}" must be an https URL`);
  if (!t.expectedFiles.length) add('error', 'declares no expectedFiles, so detection cannot work');
}

/** Validate the whole catalog. Returns every issue, not just the first. */
export function validateCatalog(templates: TemplateDefinition[] = TEMPLATES): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const ids = new Map<string, number>();
  for (const t of templates) {
    ids.set(t.id, (ids.get(t.id) ?? 0) + 1);
    checkTemplate(t, issues);
  }
  for (const [id, n] of ids) {
    if (n > 1) issues.push({ templateId: id, severity: 'error', message: `duplicate template id (${n} occurrences)` });
  }
  // Every runtime the platform can provision should be reachable from at least
  // one template, otherwise users can pick a runtime they can never create.
  for (const runtime of Object.keys(RUNTIME_IMAGES)) {
    if (!templates.some((t) => t.runtime === runtime)) {
      issues.push({ templateId: '(catalog)', severity: 'warning', message: `runtime ${runtime} has no template — clients cannot create it` });
    }
  }
  return issues;
}

/** Only the blocking problems. A catalog with any of these must not ship. */
export function catalogErrors(issues: SchemaIssue[] = validateCatalog()): SchemaIssue[] {
  return issues.filter((i) => i.severity === 'error');
}

/** Quoting re-exported so tests can assert the compiler never leaks a quote. */
export { shq, TEMPLATE_BY_ID };