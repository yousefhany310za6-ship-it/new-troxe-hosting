import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

// ---- Enums ----
export const userRole = pgEnum('user_role', ['user', 'admin']);
export const sessionStatus = pgEnum('session_status', ['success', 'failed']);
export const serverStatus = pgEnum('server_status', ['online', 'offline', 'restarting']);
export const serverRuntime = pgEnum('server_runtime', ['Node.js', 'Python', 'Bun', 'PHP']);
export const backupType = pgEnum('backup_type', ['auto', 'manual']);

// ---- Users ----
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 30 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  avatarUrl: text('avatar_url'),
  role: userRole('role').default('user').notNull(),
  notifyRestarts: boolean('notify_restarts').default(true).notNull(),
  notifyInvoices: boolean('notify_invoices').default(true).notNull(),
  notifyMarketing: boolean('notify_marketing').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---- Login sessions / history (Overview page) ----
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  refreshHash: text('refresh_hash'),
  ip: varchar('ip', { length: 45 }),
  device: varchar('device', { length: 255 }),
  location: varchar('location', { length: 255 }),
  countryCode: varchar('country_code', { length: 2 }),
  status: sessionStatus('status').default('success').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---- Plans (Starter $1 / Pro $2 / Premium $3 / Free $0) ----
export const plans = pgTable('plans', {
  id: varchar('id', { length: 32 }).primaryKey(), // free | starter | pro | premium
  name: varchar('name', { length: 64 }).notNull(),
  priceCents: integer('price_cents').default(0).notNull(),
  cpuLimit: varchar('cpu_limit', { length: 16 }).default('0.5').notNull(),
  ramMb: integer('ram_mb').default(512).notNull(),
  storageGb: integer('storage_gb').default(1).notNull(),
});

// ---- Servers ----
export const servers = pgTable('servers', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 32 }).notNull(),
  runtime: serverRuntime('runtime').notNull(),
  runtimeVersion: varchar('runtime_version', { length: 64 }),
  status: serverStatus('status').default('offline').notNull(),
  region: varchar('region', { length: 32 }).default('fra-de').notNull(),
  ip: varchar('ip', { length: 45 }),
  planId: varchar('plan_id', { length: 32 }).references(() => plans.id),
  startup: text('startup').notNull(),
  // AES-256-GCM encrypted JSON: [{k,v}]
  envEncrypted: text('env_encrypted'),
  autoRestart: boolean('auto_restart').default(true).notNull(),
  autoBackup: boolean('auto_backup').default(true).notNull(),
  containerId: varchar('container_id', { length: 128 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---- Backups (S3 keys) ----
export const backups = pgTable('backups', {
  id: uuid('id').defaultRandom().primaryKey(),
  serverId: uuid('server_id').references(() => servers.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  size: varchar('size', { length: 32 }),
  s3Key: text('s3_key').notNull(),
  type: backupType('type').default('manual').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ---- Metrics rollup (optional if Redis covers live stats) ----
export const serverMetrics = pgTable('server_metrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  serverId: uuid('server_id').references(() => servers.id, { onDelete: 'cascade' }).notNull(),
  cpu: integer('cpu').notNull(),
  ram: integer('ram').notNull(),
  at: timestamp('at').defaultNow().notNull(),
});

export type EnvVar = { k: string; v: string };
export const RUNTIME_VERSIONS: Record<string, string> = {
  'Node.js': 'Node.js 20.11',
  Python: 'Python 3.11',
  Bun: 'Bun 1.2',
  PHP: 'PHP 8.3',
};
