/**
 * Minimal 5-field cron (pure — no dependencies, unit-testable).
 *
 * Fields: minute hour day-of-month month day-of-week, evaluated in UTC.
 * Supported per field: `*`, `*\/n`, `a-b`, `a-b/n`, comma lists, and English
 * month/day names (jan..dec, sun..sat). Anything else (seconds fields, `?`,
 * `L`, `W`, `#`, years) is rejected — the schedule form only offers what this
 * parser understands, so a saved expression always means what it says.
 *
 * Day-of-month vs day-of-week follows standard cron OR semantics: when both
 * are restricted, a day matching EITHER fires; when one is `*`, only the
 * other decides.
 */

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const FIELD_LIMITS: Array<{ min: number; max: number; names?: Record<string, number> }> = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12, names: MONTH_NAMES }, // month
  { min: 0, max: 7, names: DOW_NAMES }, // day of week (7 = Sunday)
];

export interface ParsedCron {
  fields: Array<Set<number>>;
  domStar: boolean;
  dowStar: boolean;
}

function parseValue(token: string, names: Record<string, number> | undefined): number | null {
  const lower = token.toLowerCase();
  if (names && lower in names) return names[lower];
  if (!/^\d+$/.test(token)) return null;
  return parseInt(token, 10);
}

function parseField(field: string, limit: { min: number; max: number; names?: Record<string, number> }): Set<number> | null {
  const out = new Set<number>();
  const parts = field.split(',');
  if (!parts.length) return null;
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) return null;
    const [range, stepRaw] = part.split('/');
    if (stepRaw !== undefined && (!/^\d+$/.test(stepRaw) || parseInt(stepRaw, 10) < 1)) return null;
    const step = stepRaw === undefined ? 1 : parseInt(stepRaw, 10);
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = limit.min;
      hi = limit.max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-');
      const va = parseValue(a.trim(), limit.names);
      const vb = parseValue(b.trim(), limit.names);
      if (va === null || vb === null || va > vb) return null;
      lo = va;
      hi = vb;
    } else {
      const v = parseValue(range, limit.names);
      if (v === null) return null;
      lo = v;
      hi = v;
    }
    // Sunday may be written as 7; normalise to 0
    if (limit.min === 0 && limit.max === 7) {
      if (lo === 7) lo = 0;
      if (hi === 7) hi = 0;
      if (lo > hi && !(lo === 0 || hi === 0)) return null;
    }
    if (lo < limit.min || hi > limit.max) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size ? out : null;
}

/** Parse or throw with a human reason. Accepts exactly 5 fields. */
export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('Use 5 fields: minute hour day month weekday');
  const parsed: Array<Set<number>> = [];
  for (let i = 0; i < 5; i++) {
    const set = parseField(fields[i], FIELD_LIMITS[i]);
    if (!set) throw new Error(`Field ${i + 1} ("${fields[i]}") is not valid`);
    parsed.push(set);
  }
  return { fields: parsed, domStar: fields[2] === '*', dowStar: fields[4] === '*' };
}

/** True when the expression is usable. */
export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

function matchesAt(cron: ParsedCron, date: Date): boolean {
  const [mi, h, dom, mo, dow] = cron.fields;
  if (!mi.has(date.getUTCMinutes())) return false;
  if (!h.has(date.getUTCHours())) return false;
  if (!mo.has(date.getUTCMonth() + 1)) return false;
  const dayMatch = dom.has(date.getUTCDate());
  const dowMatch = dow.has(date.getUTCDay());
  if (cron.domStar && cron.dowStar) return true;
  if (cron.domStar) return dowMatch;
  if (cron.dowStar) return dayMatch;
  return dayMatch || dowMatch;
}

/**
 * The next `count` fire times strictly after `from` (UTC). Scans minute by
 * minute with a one-year cap so a pathological expression terminates.
 */
export function nextRuns(expr: string, from: Date, count = 5): Date[] {
  const cron = parseCron(expr);
  const out: Date[] = [];
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const cap = from.getTime() + 366 * 86400_000;
  while (out.length < Math.min(Math.max(count, 1), 20) && cursor.getTime() <= cap) {
    if (matchesAt(cron, cursor)) out.push(new Date(cursor.getTime()));
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return out;
}

/** Plain-language summary for the schedule list (best-effort, honest). */
export function describeCron(expr: string): string {
  try {
    const cron = parseCron(expr);
    const [mi, h, dom, mo, dow] = cron.fields;
    const at = (s: Set<number>) => [...s].sort((a, b) => a - b).join(',');
    if (cron.domStar && cron.dowStar) {
      if (mi.size === 1 && h.size === 1) {
        const hh = String([...h][0]).padStart(2, '0');
        const mm = String([...mi][0]).padStart(2, '0');
        return mo.size === 12 ? `Daily at ${hh}:${mm} UTC` : `At ${hh}:${mm} UTC in ${at(mo)}`;
      }
      return `Cron ${expr.trim()} (UTC)`;
    }
    return `Cron ${expr.trim()} (UTC)`;
  } catch {
    return expr;
  }
}
