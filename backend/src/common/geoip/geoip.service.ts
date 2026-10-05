import { Injectable, Logger } from '@nestjs/common';
import geoip from 'geoip-lite';

export interface GeoResult {
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
}

/** ISO 3166-1 alpha-2 → localized English country name (no extra dep). */
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

function countryName(code: string | null | undefined): string | null {
  if (!code || code.length !== 2) return null;
  try {
    return REGION_NAMES.of(code.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

/** strip IPv4-mapped IPv6 prefix (::ffff:1.2.3.4) */
function normalizeIp(ip: string): string {
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return m ? m[1] : ip;
}

export function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) return true;
  const v = normalizeIp(ip.trim());
  if (v === 'localhost' || v === '') return true;
  const lower = v.toLowerCase();
  if (v.includes(':')) {
    // IPv6: only loopback / unspecified / link-local / unique-local are private
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fe90:') || lower.startsWith('fea0:') || lower.startsWith('feb0:')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    return false; // global IPv6 → let the DB decide
  }
  // IPv4 ranges
  const parts = v.split('.');
  if (parts.length !== 4) return true;
  const n = parts.map((p) => Number(p));
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = n;
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 0) return true; // 0/8
  if (a >= 224) return true; // multicast/reserved
  return false;
}

/**
 * Offline GeoIP lookup backed by the bundled geoip-lite (MaxMind GeoLite2)
 * database. Never throws, never touches the network — a lookup failure must
 * never break login/session recording.
 */
@Injectable()
export class GeoIpService {
  private readonly log = new Logger(GeoIpService.name);

  lookup(ip: string | null | undefined): GeoResult | null {
    if (!ip || isPrivateIp(ip)) return null;
    try {
      const hit = geoip.lookup(normalizeIp(ip));
      if (!hit || !hit.country) return null;
      return {
        country: countryName(hit.country),
        countryCode: hit.country,
        region: hit.region || null,
        city: hit.city || null,
      };
    } catch (e) {
      this.log.warn(`geoip lookup failed for ${ip}: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * "City, Country" → falls back to the coarsest known part. The geoip-lite
   * `region` is an ISO-3166-2 code ("C" for Cairo) which is cryptic in a UI,
   * so it's only used when no city and no country name are known.
   */
  formatLocation(geo: GeoResult | null): string | null {
    if (!geo) return null;
    if (geo.city && geo.country) return geo.city === geo.country ? geo.city : `${geo.city}, ${geo.country}`;
    if (geo.city) return geo.city;
    if (geo.country) return geo.country;
    return geo.region;
  }
}
