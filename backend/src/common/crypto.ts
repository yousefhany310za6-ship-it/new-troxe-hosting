import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../config/env';
import { AppError } from './errors';

function key(): Buffer {
  return Buffer.from(config.ENV_ENCRYPTION_KEY, 'hex'); // validated: exactly 64 hex chars
}

/** AES-256-GCM. Output: `iv:tag:ciphertext` (all hex). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

export function decryptSecret<T>(payload: string): T {
  try {
    const [ivHex, tagHex, dataHex] = payload.split(':');
    if (!ivHex || !tagHex || !dataHex) throw new Error('malformed');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const out = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return JSON.parse(out.toString('utf8')) as T;
  } catch {
    // corrupted row or key rotation → never leak crypto internals
    throw new AppError('ENV_DECRYPT_FAILED', 500, 'Stored environment variables cannot be decrypted');
  }
}

export function encryptEnv(vars: EnvPairs): string {
  return encryptSecret(JSON.stringify(vars));
}

export function decryptEnv(payload: string): EnvPairs {
  return decryptSecret<EnvPairs>(payload);
}

export type EnvPairs = { k: string; v: string }[];

/** Values never leave the API; keys are safe to show. */
export const maskEnv = (vars: EnvPairs): EnvPairs =>
  vars.map((r) => ({ k: r.k, v: r.v ? '••••••••••••' : '' }));

export const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

/** URL-safe random secret (refresh tokens, etc.) */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Constant-time string comparison (handles length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // still do a comparison to keep timing roughly flat
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
