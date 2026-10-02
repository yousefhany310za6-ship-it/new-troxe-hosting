import 'dotenv/config';
import { randomBytes } from 'crypto';
import type { StringValue } from 'ms';

/**
 * Central, validated configuration.
 *
 * Fail-fast contract:
 *  - In production every secret MUST be present, long and strong, otherwise the
 *    process refuses to boot (no silent `?? 'dev'` fallbacks anywhere in the app).
 *  - In development/test a missing secret is generated ephemerally (random per
 *    boot) so nobody can accidentally ship a known key, with a loud warning.
 */

const NODE_ENV = (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test';
const IS_PROD = NODE_ENV === 'production';

type Raw = Record<string, string | undefined>;
const raw: Raw = process.env;

const errors: string[] = [];
const warnings: string[] = [];

function need(name: string, opts: { min?: number; max?: number; re?: RegExp; hint: string }): string {
  const v = (raw[name] ?? '').trim();
  if (!v) {
    if (IS_PROD) errors.push(`${name} is required. ${opts.hint}`);
    else warnings.push(`${name} missing — using an ephemeral random value (sessions reset on restart).`);
    return '';
  }
  if (opts.min !== undefined && v.length < opts.min) {
    errors.push(`${name} must be at least ${opts.min} characters (got ${v.length}). ${opts.hint}`);
  }
  if (opts.max !== undefined && v.length > opts.max) errors.push(`${name} must be at most ${opts.max} characters.`);
  if (opts.re && !opts.re.test(v)) errors.push(`${name} is malformed. ${opts.hint}`);
  return v;
}

function num(name: string, def: number, min: number, max: number): number {
  const v = raw[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    errors.push(`${name} must be a number between ${min} and ${max}.`);
    return def;
  }
  return Math.trunc(n);
}

function bool(name: string, def: boolean): boolean {
  const v = raw[name];
  if (v === undefined || v === '') return def;
  if (['1', 'true', 'yes', 'on'].includes(v.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(v.toLowerCase())) return false;
  errors.push(`${name} must be a boolean (true/false).`);
  return def;
}

function ephemeralSecret(): string {
  return randomBytes(48).toString('base64url');
}

const LOG_LEVELS = ['verbose', 'debug', 'log', 'warn', 'error'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

/** Unknown levels fall back to `log` (validated, never a crash). */
function logLevel(v: string | undefined): LogLevel {
  const level = (v ?? 'log').trim().toLowerCase();
  if ((LOG_LEVELS as readonly string[]).includes(level)) return level as LogLevel;
  errors.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}.`);
  return 'log';
}

/**
 * Volume-maintenance image (chown/tar/du helpers run as root): must be a
 * digest ref. A mutable tag here would hand root-execution to whoever
 * republishes the tag — fail the prod boot instead of running it.
 */
function helperImage(v: string): string {
  const image = v.trim();
  if (IS_PROD && !image.includes('@sha256:')) {
    errors.push('HELPER_IMAGE must be a digest ref (name@sha256:...) in production.');
    return 'alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc';
  }
  return image;
}

/**
 * Access-token lifetime: must look like `90s`, `15m` or `1h` and land in
 * 60s..1h. An operator typo (e.g. `100y`) must fail the boot, never mint
 * forever-tokens. Returns an `ms` StringValue so jsonwebtoken's
 * `expiresIn` accepts it without casts.
 */
function accessTtl(v: string): StringValue {
  const m = /^(\d+)(s|m|h)$/.exec(v.trim());
  const secs = m ? Number(m[1]) * (m[2] === 's' ? 1 : m[2] === 'm' ? 60 : 3600) : NaN;
  if (!m || !Number.isSafeInteger(secs) || secs < 60 || secs > 3600) {
    errors.push('JWT_ACCESS_TTL must look like 15m (60s..1h).');
    return '15m';
  }
  return `${Number(m[1])}${m[2]}` as StringValue;
}

// --- Secrets -----------------------------------------------------------------
const secretHint = 'Generate with: openssl rand -base64 48';

let ACCESS_SECRET = need('JWT_ACCESS_SECRET', { min: 32, hint: secretHint });
let REFRESH_SECRET = need('JWT_REFRESH_SECRET', { min: 32, hint: secretHint });
let ENV_KEY = need('ENV_ENCRYPTION_KEY', {
  re: /^[0-9a-fA-F]{64}$/,
  hint: 'AES-256 key, 64 hex chars. Generate with: openssl rand -hex 32',
});

let WS_TICKET_SECRET = raw.WS_TICKET_SECRET?.trim();
if (!WS_TICKET_SECRET) WS_TICKET_SECRET = ACCESS_SECRET ?? raw.JWT_ACCESS_SECRET?.trim();
if (!WS_TICKET_SECRET) WS_TICKET_SECRET = ephemeralSecret();

if (IS_PROD) {
  if (ACCESS_SECRET && REFRESH_SECRET && ACCESS_SECRET === REFRESH_SECRET)
    errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
  if (ENV_KEY && !raw.ENV_ENCRYPTION_KEY) errors.push('ENV_ENCRYPTION_KEY is required in production.');
} else {
  if (!ACCESS_SECRET) ACCESS_SECRET = ephemeralSecret();
  if (!REFRESH_SECRET) REFRESH_SECRET = ephemeralSecret();
  if (!ENV_KEY) {
    ENV_KEY = ephemeralSecret().slice(0, 32);
    ENV_KEY = Buffer.from(ENV_KEY).toString('hex').slice(0, 64).padEnd(64, '0');
  }
}

const DATABASE_URL = (raw.DATABASE_URL ?? '').trim();
if (!DATABASE_URL) {
  errors.push('DATABASE_URL is required (postgresql://user:pass@host:5432/db).');
} else if (!/^postgres(ql)?:\/\//.test(DATABASE_URL)) {
  errors.push('DATABASE_URL must start with postgresql:// or postgres://');
}

// --- CORS --------------------------------------------------------------------
const ALLOWED_ORIGINS = (raw.FRONTEND_URLS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (IS_PROD && ALLOWED_ORIGINS.some((o) => o === '*' || o === 'null'))
  errors.push('FRONTEND_URLS must never contain "*" when credentials are enabled.');
if (IS_PROD && ALLOWED_ORIGINS.some((o) => o.startsWith('http://')))
  warnings.push('FRONTEND_URLS contains an http:// origin — only valid for local development.');

// --- Regions -----------------------------------------------------------------
const REGIONS = (raw.REGIONS ?? 'fra-de').split(',').map((s) => s.trim()).filter(Boolean);

if (errors.length) {
  const body = ['Invalid environment configuration — refusing to start:', ...errors.map((e) => `  • ${e}`)].join('\n');
  throw new Error(body);
}
if (warnings.length && !IS_PROD) {
  // eslint-disable-next-line no-console
  console.warn(`\n[troxe-api] config warnings:\n${warnings.map((w) => `  • ${w}`).join('\n')}\n`);
}

export interface AppConfig {
  readonly NODE_ENV: string;
  readonly IS_PROD: boolean;
  readonly PORT: number;
  readonly DATABASE_URL: string;
  readonly PG_POOL_MAX: number;
  readonly PG_SSL: boolean;
  readonly PG_STATEMENT_TIMEOUT_MS: number;
  readonly JWT_ACCESS_SECRET: string;
  readonly JWT_REFRESH_SECRET: string;
  readonly JWT_ACCESS_TTL: StringValue;
  readonly JWT_REFRESH_TTL_SEC: number;
  readonly BCRYPT_ROUNDS: number;
  readonly ENV_ENCRYPTION_KEY: string;
  readonly WS_TICKET_SECRET: string;
  readonly REFRESH_COOKIE: string;
  readonly ALLOWED_ORIGINS: readonly string[];
  readonly TRUST_PROXY: boolean;
  readonly REGIONS: readonly string[];
  readonly MAX_SERVERS_PER_USER: number;
  readonly MAX_ENV_VARS: number;
  readonly AUTO_START_ON_CREATE: boolean;
  readonly DOCKER_ENABLED: boolean;
  readonly DOCKER_SOCKET: string;
  readonly HELPER_IMAGE: string;
  readonly HARDEN_NETWORK: boolean;
  readonly CONTAINER_PIDS_LIMIT: number;
  readonly BACKUP_DIR: string;
  readonly BACKUP_MAX_TOTAL_MB: number;
  readonly RATE_LIMIT_WINDOW_MS: number;
  readonly RATE_LIMIT_MAX: number;
  readonly AUTH_RATE_LIMIT_MAX: number;
  readonly LOCKOUT_THRESHOLD: number;
  readonly LOG_LEVEL: LogLevel;
}

export const config: AppConfig = Object.freeze({
  NODE_ENV,
  IS_PROD,
  PORT: num('PORT', 3300, 1, 65535),
  DATABASE_URL,
  PG_POOL_MAX: num('PG_POOL_MAX', 10, 1, 100),
  PG_SSL: bool('PG_SSL', /sslmode=require/.test(DATABASE_URL)),
  PG_STATEMENT_TIMEOUT_MS: num('PG_STATEMENT_TIMEOUT_MS', 15000, 1000, 120000),

  JWT_ACCESS_SECRET: ACCESS_SECRET,
  JWT_REFRESH_SECRET: REFRESH_SECRET,
  JWT_ACCESS_TTL: accessTtl(raw.JWT_ACCESS_TTL ?? '15m'),
  JWT_REFRESH_TTL_SEC: num('JWT_REFRESH_TTL_SEC', 7 * 24 * 3600, 600, 30 * 24 * 3600),
  BCRYPT_ROUNDS: num('BCRYPT_ROUNDS', IS_PROD ? 12 : 10, IS_PROD ? 10 : 4, 15),
  ENV_ENCRYPTION_KEY: ENV_KEY,
  WS_TICKET_SECRET: WS_TICKET_SECRET,
  REFRESH_COOKIE: IS_PROD ? '__Host-troxe_refresh' : 'troxe_refresh',

  ALLOWED_ORIGINS: Object.freeze(ALLOWED_ORIGINS),
  TRUST_PROXY: bool('TRUST_PROXY', false),
  REGIONS: Object.freeze(REGIONS),

  MAX_SERVERS_PER_USER: num('MAX_SERVERS_PER_USER', 10, 1, 500),
  MAX_ENV_VARS: num('MAX_ENV_VARS', 40, 1, 200),
  AUTO_START_ON_CREATE: bool('AUTO_START_ON_CREATE', true),

  DOCKER_ENABLED: bool('DOCKER_ENABLED', true),
  DOCKER_SOCKET: raw.DOCKER_SOCKET ?? '/var/run/docker.sock',
  HELPER_IMAGE: helperImage(raw.HELPER_IMAGE ?? 'alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc'), // alpine:3.20
  HARDEN_NETWORK: bool('HARDEN_NETWORK', true),
  CONTAINER_PIDS_LIMIT: num('CONTAINER_PIDS_LIMIT', 512, 32, 8192),

  BACKUP_DIR: raw.BACKUP_DIR ?? './data/backups',
  BACKUP_MAX_TOTAL_MB: num('BACKUP_MAX_TOTAL_MB', 2048, 16, 1024 * 1024),

  RATE_LIMIT_WINDOW_MS: num('RATE_LIMIT_WINDOW_MS', 60000, 1000, 3600000),
  RATE_LIMIT_MAX: num('RATE_LIMIT_MAX', 300, 10, 100000),
  AUTH_RATE_LIMIT_MAX: num('AUTH_RATE_LIMIT_MAX', 8, 3, 1000),
  LOCKOUT_THRESHOLD: num('LOCKOUT_THRESHOLD', 6, 3, 100),

  LOG_LEVEL: logLevel(raw.LOG_LEVEL),
});

// Authoritative gate: the early check above only sees secret errors — every
// num()/bool()/accessTtl() call inside the freeze pushes here, so re-check
// AFTER construction. Without this, invalid numeric/boolean/TTL values boot
// silently with defaults (fail-open config).
if (errors.length) {
  const body = ['Invalid environment configuration — refusing to start:', ...errors.map((e) => `  • ${e}`)].join('\n');
  throw new Error(body);
}
