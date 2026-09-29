import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const KEY = Buffer.from(
  process.env.ENV_ENCRYPTION_KEY ??
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'hex',
);

export function encryptEnv(obj: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

export function decryptEnv<T>(payload: string): T {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const out = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return JSON.parse(out.toString('utf8')) as T;
}

export const maskEnv = (vars: { k: string; v: string }[]) =>
  vars.map((r) => ({ k: r.k, v: r.v ? '••••••••••••' : '' }));
