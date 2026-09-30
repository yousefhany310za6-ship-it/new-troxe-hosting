import { bigint, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

// ---- Enums ------------------------------------------------------------------
export const userRole = pgEnum('user_role', ['user', 'admin']);
export const sessionStatus = pgEnum('session_status', ['success', 'failed']);
export const serverStatus = pgEnum('server_status', [
  'provisioning', // resources are being created
  'online',       // container running
  'offline',      // container stopped (or not started yet)
  'restarting',   // transitional
  'deleting',     // teardown in progress
  'error',        // provisioning/runtime failure (see lastError)
]);
export const serverRuntime = pgEnum('server_runtime', ['Node.js', 'Python', 'Bun', 'PHP']);
export const backupType = pgEnum('backup_type', ['auto', 'manual']);
export const backupStatus = pgEnum('backup_status', ['pending', 'ready', 'failed']);

// ---- Users ------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 30 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  avatarUrl: text('avatar_url'),
  role: userRole('role').default('user').notNull(),
  /** Server-side plan assignment — the client can NEVER choose its plan.
   *  Upgrades happen only through billing/admin flows (future phase). */
  planId: varchar('plan_id', { length: 32 }).default('free').notNull().references(() => plans.id),
  // progressive account lockout
  failedLogins: integer('failed_logins').default(0).notNull(),
  lockedUntil: timestamp('locked_until'),
  passwordChangedAt: timestamp('password_changed_at').defaultNow().notNull(),
  /**
   * Access-token generation. Embedded as `v` in every access JWT and checked
   * by the guard: any explicit revocation (password change, logout,
   * logout-all) bumps it, instantly killing all outstanding access tokens
   * (clients transparently recover via their intact refresh sessions).
   */
  tokenVersion: integer('token_version').default(0).notNull(),
  notifyRestarts: boolean('notify_restarts').default(true).notNull(),
  notifyInvoices: boolean('notify_invoices').default(true).notNull(),
  notifyMarketing: boolean('notify_marketing').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---- Login history (Overview page / security telemetry) ---------------------
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  ip: varchar('ip', { length: 45 }),
  device: varchar('device', { length: 255 }),
  location: varchar('location', { length: 255 }),
  countryCode: varchar('country_code', { length: 2 }),
  status: sessionStatus('status').default('success').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('sessions_user_created_idx').on(t.userId, t.createdAt)]);

// ---- Refresh sessions (rotating, replay-detecting) --------------------------
export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** All rotations of one browser session share a family; reuse of an old
   *  refresh token revokes the whole family (theft detection). */
  familyId: uuid('family_id').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  /** sha256(refresh secret) — never the token itself */
  refreshTokenHash: varchar('refresh_token_hash', { length: 64 }).notNull(),
  /**
   * Previous secret's hash + when it was superseded. A retry presenting the
   * just-rotated secret inside the grace window is treated as a duplicate
   * request (re-issued, never a family wipe) — only a DISTINCT second reuse
   * kills the family (theft detection).
   */
  prevRefreshTokenHash: varchar('prev_refresh_token_hash', { length: 64 }),
  prevRotatedAt: timestamp('prev_rotated_at'),
  ip: varchar('ip', { length: 45 }),
  device: varchar('device', { length: 255 }),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('auth_sessions_hash_idx').on(t.refreshTokenHash),
  index('auth_sessions_user_idx').on(t.userId),
  index('auth_sessions_family_idx').on(t.familyId),
]);

// ---- Plans ------------------------------------------------------------------
export const plans = pgTable('plans', {
  id: varchar('id', { length: 32 }).primaryKey(), // free | starter | pro | ...
  name: varchar('name', { length: 64 }).notNull(),
  priceCents: integer('price_cents').default(0).notNull(),
  /** hard container limits */
  cpuMilli: integer('cpu_milli').default(250).notNull(), // 1000 = 1 vCPU
  ramMb: integer('ram_mb').default(256).notNull(),
  storageGb: integer('storage_gb').default(1).notNull(),
  maxServers: integer('max_servers').default(1).notNull(),
  maxBackupSlots: integer('max_backup_slots').default(0).notNull(),
  custom: boolean('custom').default(false).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
});

// ---- Servers (one isolated sandbox per client) ------------------------------
export const servers = pgTable('servers', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 32 }).notNull(),
  runtime: serverRuntime('runtime').notNull(),
  runtimeVersion: varchar('runtime_version', { length: 128 }),
  status: serverStatus('status').default('provisioning').notNull(),
  lastError: text('last_error'),
  region: varchar('region', { length: 32 }).default('fra-de').notNull(),
  planId: varchar('plan_id', { length: 32 }).references(() => plans.id),
  /** quota snapshot taken at creation time */
  cpuMilli: integer('cpu_milli').default(250).notNull(),
  ramMb: integer('ram_mb').default(256).notNull(),
  storageGb: integer('storage_gb').default(1).notNull(),

  startup: text('startup').notNull(),
  /** AES-256-GCM encrypted JSON [{k,v}] */
  envEncrypted: text('env_encrypted'),

  /** isolated docker resources, all labelled troxe.serverId=<id> */
  image: varchar('image', { length: 128 }),
  containerId: varchar('container_id', { length: 64 }),
  containerName: varchar('container_name', { length: 64 }),
  networkName: varchar('network_name', { length: 64 }),
  networkSubnet: varchar('network_subnet', { length: 64 }),
  volumeName: varchar('volume_name', { length: 64 }),

  autoRestart: boolean('auto_restart').default(true).notNull(),
  autoBackup: boolean('auto_backup').default(true).notNull(),
  provisionedAt: timestamp('provisioned_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('servers_owner_name_idx').on(t.ownerId, t.name),
  index('servers_owner_idx').on(t.ownerId),
  index('servers_status_idx').on(t.status),
]);

// ---- Backups ----------------------------------------------------------------
export const backups = pgTable('backups', {
  id: uuid('id').defaultRandom().primaryKey(),
  serverId: uuid('server_id').references(() => servers.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  /** path or object-storage key */
  storageKey: text('storage_key').notNull(),
  status: backupStatus('status').default('pending').notNull(),
  type: backupType('type').default('manual').notNull(),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('backups_server_idx').on(t.serverId)]);

// ---- Metrics rollup ---------------------------------------------------------
// ---- Server lifecycle events (per-server audit trail) -----------------------
export const serverEvents = pgTable('server_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  serverId: uuid('server_id').references(() => servers.id, { onDelete: 'cascade' }).notNull(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  type: varchar('type', { length: 48 }).notNull(), // create | start | stop | ...
  detail: jsonb('detail'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('server_events_server_idx').on(t.serverId, t.createdAt)]);

// ---- Platform audit log -----------------------------------------------------
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  /** email for unauthenticated events (e.g. failed login of unknown user) */
  actorEmail: varchar('actor_email', { length: 255 }),
  action: varchar('action', { length: 64 }).notNull(), // auth.login.fail | server.delete ...
  targetType: varchar('target_type', { length: 32 }),
  targetId: varchar('target_id', { length: 64 }),
  ip: varchar('ip', { length: 45 }),
  userAgent: varchar('user_agent', { length: 255 }),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('audit_logs_actor_idx').on(t.actorId, t.createdAt),
  index('audit_logs_action_idx').on(t.action, t.createdAt),
]);

// ---- Types ------------------------------------------------------------------
export type EnvVar = { k: string; v: string };
export type User = typeof users.$inferSelect;
export type Server = typeof servers.$inferSelect;
export type Plan = typeof plans.$inferSelect;

/** Display versions shown in the dashboard */
export const RUNTIME_VERSIONS: Record<string, string> = {
  'Node.js': 'Node.js 20.11',
  Python: 'Python 3.11',
  Bun: 'Bun 1.2',
  PHP: 'PHP 8.3',
};
