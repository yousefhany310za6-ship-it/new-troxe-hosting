/**
 * Resource allocation policy (pure — no Nest/Drizzle imports, unit-testable).
 *
 * ONE budget per resource, shared by the whole account.
 *
 * A plan advertises "1.5 vCPU, 3 GB RAM, 12 GB disk" and that is the entire
 * account: the owner divides it across their servers. A Platinum account with
 * twelve servers does NOT get 12 × 1.5 vCPU — it gets 1.5 vCPU to share, and
 * when the budget runs out the only ways forward are a bigger plan or deleting
 * a server. (An earlier revision of this file modelled the plan numbers as a
 * per-server allowance plus a separate, larger pool; migration 0027 drops that
 * pool because it let an account provision N times what it paid for.)
 *
 * So for each resource: `total = plan value`, `used = sum over the owner's
 * servers`, `available = total − used`, and a new server (or a resize) may
 * take at most what is left. `maxServers` still caps the COUNT independently.
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

/** Platform maxima as configured (env → config), clamped to the constants. */
export function platformHardMax(overrides?: HardMax): Record<ResourceKey, number> {
  const out = {} as Record<ResourceKey, number>;
  for (const key of RESOURCE_KEYS) {
    const wanted = overrides?.[key] ?? RESOURCE_HARD_MAX[key];
    out[key] = Math.max(RESOURCE_MIN[key], Math.min(wanted, RESOURCE_HARD_MAX[key]));
  }
  return out;
}

/** The `plans` columns the policy reads — the values ARE the account budget. */
export interface PlanResourceRow {
  id?: string;
  name?: string;
  cpuMilli: number;
  ramMb: number;
  storageGb: number;
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
  /** the account's whole budget for this resource (the plan value) */
  total: number;
  /** already committed by the owner's servers */
  used: number;
  /** what a new server (or a resize) may still take: total − used */
  available: number;
  /** the slider/input upper bound — simply what is left */
  max: number;
  /**
   * Not enough left for even the smallest possible server. The account has to
   * delete or shrink a server, or upgrade, before it can create another one.
   */
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
 * The account's whole budget for one resource — the plan value, floored at the
 * smallest server we can boot and capped at the platform maximum.
 */
export function budgetCeiling(plan: PlanResourceRow, key: ResourceKey): number {
  return Math.max(RESOURCE_MIN[key], Math.min(Number(plan[key]) || 0, RESOURCE_HARD_MAX[key]));
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

/**
 * Build the full limit set for one owner: what the plan buys, what the
 * owner's servers already hold, and what is therefore left to allocate.
 */
export function resolveLimits(plan: PlanResourceRow, usage: ResourceUsage = EMPTY_USAGE): ResourceLimits {
  const out = {} as ResourceLimits;
  for (const key of RESOURCE_KEYS) {
    const min = RESOURCE_MIN[key];
    const total = budgetCeiling(plan, key);
    // `used` is clamped to `total` so a plan DOWNGRADE (admin lowers the
    // numbers under an account that already holds more) reads as "nothing
    // left" rather than as a negative allocation.
    const used = Math.max(0, Math.min(Number(usage[key]) || 0, total));
    const available = Math.max(0, total - used);
    out[key] = {
      key,
      min,
      step: RESOURCE_STEP[key],
      total,
      used,
      available,
      max: Math.max(min, available),
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

/**
 * What the create form starts from: whatever is left of the account budget.
 * A brand-new account gets the whole plan on its first server — which is
 * exactly the old behaviour, and the honest reading of "your plan has 1.5
 * vCPU": one server may hold it all, further servers share what's left.
 */
export function pickDefaults(limits: ResourceLimits): ResourceGrant {
  return {
    cpuMilli: clampToLimit(limits.cpuMilli, limits.cpuMilli.available),
    ramMb: clampToLimit(limits.ramMb, limits.ramMb.available),
    storageGb: clampToLimit(limits.storageGb, limits.storageGb.available),
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

    // Not enough budget left for even the smallest server. The only ways out
    // are a bigger plan or freeing resources by deleting/shrinking a server —
    // say exactly that instead of a bare "quota exceeded".
    if (limit.exhausted) {
      return {
        ok: false,
        grant: defaults,
        refusal: {
          key,
          code: QUOTA_CODE[key],
          message:
            `Your "${planName}" plan has no ${LABEL[key]} left — all ${formatResource(key, limit.total)} ` +
            `are already used by your servers. Delete a server, make one smaller, or upgrade to add more.`,
        },
      };
    }

    if (asked !== undefined && asked > limit.max) {
      return {
        ok: false,
        grant: defaults,
        refusal: {
          key,
          code: QUOTA_CODE[key],
          message:
            `Your "${planName}" plan has ${formatResource(key, limit.available)} of ${LABEL[key]} left ` +
            `across all your servers (requested ${formatResource(key, asked)}). ` +
            `Delete a server, make one smaller, or upgrade to add more.`,
        },
      };
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