/**
 * Server access policy (pure — no Nest/Drizzle imports, unit-testable).
 *
 * The owner can do everything. Anyone else needs a row in server_users with
 * the specific permission below. The permission is checked server-side on
 * every endpoint AND every socket event — hiding a button is never the
 * enforcement.
 */

/** Every permission the platform can grant on a server. */
export const SERVER_PERMISSIONS = [
  'server.view', // details, stats, usage, logs, activity, events, ports view, package list, schedules list
  'console.access', // open a console session
  'files.read', // list, read, preview, download
  'files.write', // write, upload, mkdir, rename, move, delete, archive, extract
  'backup.read', // list, quota
  'backup.write', // create, restore, delete, download
  'packages.write', // install, uninstall
  'control.power', // start, stop, restart, reprovision
  'settings.update', // name, main file, startup, env, auto-backup, ports allocate
  'schedule.manage', // create, edit, toggle, delete schedules
] as const;

export type ServerPermission = (typeof SERVER_PERMISSIONS)[number];

/** Operations that stay owner-only no matter what is granted. */
export const OWNER_ONLY = ['delete server', 'reinstall', 'change runtime', 'manage subusers'] as const;

/** Maximum subusers on one server (abuse control, documented in the UI). */
export const MAX_SUBUSERS = 20;

/** Keep only known keys, drop the rest, dedupe. Client input is never trusted. */
export function normalizePermissions(input: unknown): ServerPermission[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<string>(SERVER_PERMISSIONS);
  const out: ServerPermission[] = [];
  for (const p of input) {
    if (typeof p === 'string' && allowed.has(p) && !out.includes(p as ServerPermission)) {
      out.push(p as ServerPermission);
    }
  }
  return out;
}

/** Owners pass everything; subusers need the exact key. */
export function hasPermission(input: { isOwner: boolean; granted: string[]; required: ServerPermission }): boolean {
  if (input.isOwner) return true;
  return input.granted.includes(input.required);
}

/** Human labels for the permission checkboxes (shown next to the key). */
export const PERMISSION_LABELS: Record<ServerPermission, { title: string; text: string }> = {
  'server.view': { title: 'View server', text: 'Details, metrics, logs, activity and the package list.' },
  'console.access': { title: 'Console', text: 'Open the live console.' },
  'files.read': { title: 'Read files', text: 'Browse, preview and download files.' },
  'files.write': { title: 'Manage files', text: 'Create, edit, upload, rename, move, archive and delete.' },
  'backup.read': { title: 'View backups', text: 'See snapshots and quota.' },
  'backup.write': { title: 'Manage backups', text: 'Create, restore, download and delete snapshots.' },
  'packages.write': { title: 'Manage packages', text: 'Install and remove packages.' },
  'control.power': { title: 'Power controls', text: 'Start, stop, restart and reprovision.' },
  'settings.update': { title: 'Edit settings', text: 'Name, main file, startup, variables, auto-backup, ports.' },
  'schedule.manage': { title: 'Manage schedules', text: 'Create, edit, enable and delete scheduled tasks.' },
};
