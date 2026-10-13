/**
 * Resource allocation policy (pure — no Nest/Drizzle imports, unit-testable).
 *
 * Two independent ceilings govern every server:
 *
 *   per-server  plans.cpu_milli / ram_mb / storage_gb — what ONE sandbox may
 *               get (the numbers the pricing pages advertise).
 *   account-wide plans.pool_* — what ALL of an owner's servers may add up to.
 *
 * Both matter: with only the per-server ceiling a Gold owner (8 servers × 1
 * vCPU) could provision 8 vCPU of Docker limits on a single host. The pool is
 * the promise the plan actually sold.
 *
 * A NULL pool is the legacy shape (rows written before migration 0026): it is
 * read as `perServer × maxServers`, which is exactly what those servers were
 * created with, so nobody is retroactively over quota.
 *
 * Everything here is deterministic and side-effect free; the service adds the
 * database work (locking, aggregation) and turns a refusal into an AppError.
 */

export type ResourceKey = 'cpuMilli' | 'ramMb' | 'storageGb';

export const RESOURCE_KEYS: readonly ResourceKey[] = ['cpuMilli', 'ramMb', 'storageGb'];

/** Floor for one server: below this the images do not even boot reliably. */
export const RESOURCE_MIN: Record<ResourceKey, number> = {
  cpuMilli: 100, // 0.1 vCPU
  ramMb: 128,
  storageGb: 1,
};

/**
 * Granularity offered to clients. Round numbers only — a slider that stops at
 * 137 MB is noise, and every stored value stays comparable.
 */
export const RESOURCE_STEP: Record<ResourceKey, number> = {
  cpuMilli: 50, // 0.05 vCPU
  ramMb: 128,
  storageGb: 1,
};

/** Absolute ceilings — no plan row and no admin override may go past these. */
export const RESOURCE_HARD_MAX: Record<ResourceKey, number> = {
  cpuMilli: 8000, // 8 vCPU
  ramMb: 24576, // 24 GB
  storageGb: 100,
};

export const RESOURCE_UNITS: Record<ResourceKey, string> = {
  cpuMilli: 'milli-vCPU',
  ramMb: 'MB',
  storageGb: 'GB',
};

const LABEL: Record<ResourceKey, string> = {
  cpuMilli: 'CPU',
  ramMb: 'memory',
  storageGb: 'storage',
};

const QUOTA_CODE: Record<ResourceKey, string> = {
  cpuMilli: 'QUOTA_CPU',
  ramMb: 'QUOTA_RAM',
  storageGb: 'QUOTA_STORAGE',
};

const POOL_COLUMN: Record<ResourceKey, 'poolCpuMilli' | 'poolRamMb' | 'poolStorageGb'> = {
  cpuMilli: 'poolCpuMilli',
  ramMb: 'poolRamMb',
  storageGb: 'poolStorageGb',
};

/** Platform maxima as configured (env → config), clamped to the constants. */
export function platformHardMax(overrides?: HardMax): Record<ResourceKey, number> {
  const out = {} as Record<ResourceKey, number>;
  for (const key of RESOURCE_KEYS) {
    const wanted = overrides?.[key] ?? RESOURCE_HARD_MAX[key];
    out[key] = Math.max(RESOURCE_MIN[key], Math.min(wanted, RESOURCE_HARD_MAX[key]));
  }
  return out;
}

/** The `plans` columns the policy reads. */
export interface PlanResourceRow {
  id?: string;
  name?: string;
  cpuMilli: number;
  ramMb: number;
  storageGb: number;
  poolCpuMilli: number | null;
  poolRamMb: number | null;
  poolStorageGb: number | null;
  maxServers: number;
}

/** What the owner currently holds, summed over their servers. */
export interface ResourceUsage {
  servers: number;
  cpuMilli: number;
  ramMb: number;
  storageGb: number;
}

/** Everything the client needs to render the picker for one resource. */
export interface ResourceLimit {
  key: ResourceKey;
  min: number;
  step: number;
  /** ceiling for a single server */
  perServerMax: number;
  /** ceiling for the whole account */
  poolMax: number;
  /** already committed by the owner's other servers */
  used: number;
  /** what a NEW server may still take (pool − used) */
  available: number;
  /** the slider/input upper bound: min(perServerMax, available) */
  max: number;
  /** the account has nothing left of this resource */
  exhausted: boolean;
}

export type ResourceLimits = Record<ResourceKey, ResourceLimit>;

const EMPTY_USAGE: ResourceUsage = { servers: 0, cpuMilli: 0, ramMb: 0, storageGb: 0 };

/** Human-readable amount, shared by API messages and admin copy. */
export function formatResource(key: ResourceKey, value: number): string {
  if (key === 'cpuMilli') {
    const vcpu = value / 1000;
    return `${Number(vcpu.toFixed(2))} vCPU`;
  }
  if (key === 'ramMb') return value >= 1024 && value % 1024 === 0 ? `${value / 1024} GB` : `${value} MB`;
  return `${value} GB`;
}

/**
 * The account-wide ceiling of a plan. Falls back to `perServer × maxServers`
 * when the column is NULL, and never returns less than a single server (a pool
 * below the per-server ceiling would make the plan self-contradictory).
 */
export function poolCeiling(plan: PlanResourceRow, key: ResourceKey): number {
  const perServer = Math.max(RESOURCE_MIN[key], Number(plan[key]) || 0);
  const raw = plan[POOL_COLUMN[key]];
  const pool = typeof raw === 'number' && raw > 0 ? raw : perServer * Math.max(1, plan.maxServers || 1);
  return Math.min(RESOURCE_HARD_MAX[key], Math.max(pool, perServer));
}

/** Snap to the step grid, never below the floor, never above the hard max. */
export function snapToStep(value: number, key: ResourceKey): number {
  if (!Number.isFinite(value)) return RESOURCE_MIN[key];
  const snapped = Math.round(value / RESOURCE_STEP[key]) * RESOURCE_STEP[key];
  return Math.max(RESOURCE_MIN[key], Math.min(snapped, RESOURCE_HARD_MAX[key]));
}

/** Keep a value inside [min, max] and on the step grid. */
export function clampToLimit(limit: ResourceLimit, value: number): number {
  if (!Number.isFinite(value)) return Math.min(limit.max, limit.min);
  return Math.max(limit.min, Math.min(snapToStep(value, limit.key), limit.max));
}

/** Build the full limit set for one owner. */
export function resolveLimits(plan: PlanResourceRow, usage: ResourceUsage = EMPTY_USAGE): ResourceLimits {
  const out = {} as ResourceLimits;
  for (const key of RESOURCE_KEYS) {
    const min = RESOURCE_MIN[key];
    const perServerMax = Math.max(min, Math.min(Number(plan[key]) || min, RESOURCE_HARD_MAX[key]));
    const poolMax = poolCeiling(plan, key);
    const used = Math.max(0, Math.min(Number(usage[key]) || 0, poolMax));
    const available = Math.max(0, poolMax - used);
    out[key] = {
      key,
      min,
      step: RESOURCE_STEP[key],
      perServerMax,
      poolMax,
      used,
      available,
      max: Math.max(min, Math.min(perServerMax, available)),
      exhausted: available < min,
    };
  }
  return out;
}

/**
 * Server-count headroom, honouring the platform-wide cap as well as the plan.
 * `0` means the account cannot add another server.
 */
export function serverHeadroom(plan: PlanResourceRow, used: number, platformMax: number): number {
  return Math.max(0, Math.min(plan.maxServers || 0, platformMax) - Math.max(0, used));
}

export interface ResourceRequest {
  cpuMilli?: number;
  ramMb?: number;
  storageGb?: number;
}

export interface ResourceGrant {
  cpuMilli: number;
  ramMb: number;
  storageGb: number;
}

/** Platform maxima, overridable from config (env.ts re-exports these). */
export type HardMax = Partial<Record<ResourceKey, number>>;

export interface ResourceRefusal {
  key: ResourceKey;
  code: string;
  message: string;
}

export interface ResolveResult {
  ok: boolean;
  grant: ResourceGrant;
  refusal?: ResourceRefusal;
}

/** A sensible starting point: the smaller of the plan's per-server ceiling
 *  and what is still free in the account pool. */
export function pickDefaults(limits: ResourceLimits): ResourceGrant {
  return {
    cpuMilli: clampToLimit(limits.cpuMilli, Math.min(limits.cpuMilli.perServerMax, limits.cpuMilli.available)),
    ramMb: clampToLimit(limits.ramMb, Math.min(limits.ramMb.perServerMax, limits.ramMb.available)),
    storageGb: clampToLimit(limits.storageGb, Math.min(limits.storageGb.perServerMax, limits.storageGb.available)),
  };
}

/**
 * Resolve a requested allocation against the limits.
 *
 * Missing values fall back to `pickDefaults`. `override` (admin, explicit and
 * audited) skips the plan ceilings but NOT the hard platform maxima and not
 * the floor — an override still cannot produce a container we would not boot.
 */
export function resolveRequest(input: {
  limits: ResourceLimits;
  requested?: ResourceRequest;
  /** plan name for the refusal message */
  planName?: string;
  override?: boolean;
  /** platform maxima (config); defaults to the module constants */
  hardMax?: HardMax;
}): ResolveResult {
  const { limits, requested = {}, planName = 'plan', override = false, hardMax = {} } = input;
  const defaults = pickDefaults(limits);
  const grant = {} as ResourceGrant;

  for (const key of RESOURCE_KEYS) {
    const limit = limits[key];
    const asked = requested[key];
    const wanted = typeof asked === 'number' && Number.isFinite(asked) ? asked : defaults[key];
    const platformMax = Math.max(RESOURCE_MIN[key], Math.min(hardMax[key] ?? RESOURCE_HARD_MAX[key], RESOURCE_HARD_MAX[key]));

    if (override) {
      if (asked !== undefined && (asked > platformMax || asked < RESOURCE_MIN[key])) {
        return {
          ok: false,
          grant: defaults,
          refusal: {
            key,
            code: 'RESOURCE_OUT_OF_RANGE',
            message: `${LABEL[key]} must be between ${RESOURCE_MIN[key]} and ${platformMax} ${RESOURCE_UNITS[key]}.`,
          },
        };
      }
      // the admin path ignores the plan ceilings entirely — only the platform
      // maximum and the floor still apply
      grant[key] = clampToLimit({ ...limit, max: platformMax }, wanted);
      continue;
    }

    // An account with nothing left of a resource cannot add a server at all:
    // even the floor would overshoot the pool.
    if (limit.exhausted) {
      return {
        ok: false,
        grant: defaults,
        refusal: {
          key,
          code: QUOTA_CODE[key],
          message: `Your "${planName}" plan has no ${LABEL[key]} left to allocate — all ${formatResource(key, limit.poolMax)} are already in use. Delete or downsize a server to free some.`,
        },
      };
    }

    const ceiling = limit.max;
    if (asked !== undefined && asked > ceiling) {
      const message =
        limit.available < limit.perServerMax && asked <= limit.perServerMax
          ? `Your "${planName}" account has ${formatResource(key, limit.available)} of ${LABEL[key]} left (requested ${formatResource(key, asked)}).`
          : `Your "${planName}" plan allows at most ${formatResource(key, limit.perServerMax)} of ${LABEL[key]} per server (requested ${formatResource(key, asked)}).`;
      return { ok: false, grant: defaults, refusal: { key, code: QUOTA_CODE[key], message } };
    }
    grant[key] = clampToLimit(limit, wanted);
  }

  return { ok: true, grant };
}

/** Only the fields the create/rescale payloads actually carry. */
export function grantOf(row: { cpuMilli: number; ramMb: number; storageGb: number }): ResourceGrant {
  return { cpuMilli: row.cpuMilli, ramMb: row.ramMb, storageGb: row.storageGb };
}

/** True when two allocations are identical (nothing to apply). */
export function sameGrant(a: ResourceGrant, b: ResourceGrant): boolean {
  return a.cpuMilli === b.cpuMilli && a.ramMb === b.ramMb && a.storageGb === b.storageGb;
}