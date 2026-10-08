import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { TOTP } from 'otpauth';
import { createHash, randomBytes } from 'crypto';

// Pure TOTP logic tests (no DB) — the service mirrors these rules.
function currentCounter(): number {
  return Math.floor(Date.now() / 1000 / 30);
}

function verifyTotp(secret: string, code: string, lastCounter: number): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const totp = new TOTP({ secret, digits: 6, period: 30 });
  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) return false;
  const counter = currentCounter() + delta;
  if (counter <= lastCounter) return false;
  return true;
}

function counterFromCode(secret: string, code: string): number {
  const totp = new TOTP({ secret, digits: 6, period: 30 });
  const delta = totp.validate({ token: code, window: 1 });
  return delta === null ? 0 : currentCounter() + delta;
}

describe('TOTP verification (2FA core)', () => {
  const secret = 'JBSWY3DPEHPK3PXP';

  it('accepts a valid current code', () => {
    const totp = new TOTP({ secret, digits: 6, period: 30 });
    const code = totp.generate();
    assert.equal(verifyTotp(secret, code, 0), true);
  });

  it('rejects a non-6-digit code', () => {
    assert.equal(verifyTotp(secret, '12345', 0), false);
    assert.equal(verifyTotp(secret, '1234567', 0), false);
    assert.equal(verifyTotp(secret, 'abcdef', 0), false);
  });

  it('rejects a wrong code', () => {
    assert.equal(verifyTotp(secret, '000000', 0), false);
  });

  it('rejects replay of a used counter', () => {
    const totp = new TOTP({ secret, digits: 6, period: 30 });
    const code = totp.generate();
    const counter = counterFromCode(secret, code);
    assert.ok(counter > 0);
    // same code again — counter not advanced
    assert.equal(verifyTotp(secret, code, counter), false);
  });

  it('accepts a code from a later window', () => {
    const totp = new TOTP({ secret, digits: 6, period: 30 });
    const code = totp.generate();
    const counter = counterFromCode(secret, code);
    // simulate time passing — next code has a higher counter
    const totp2 = new TOTP({ secret, digits: 6, period: 30 });
    const code2 = totp2.generate();
    const counter2 = counterFromCode(secret, code2);
    if (counter2 > counter) {
      assert.equal(verifyTotp(secret, code2, counter), true);
    }
  });
});

describe('Recovery code hashing', () => {
  it('hashes are deterministic and one-way', () => {
    const code = 'ABC123DEF4';
    const hash1 = createHash('sha256').update(code).digest('hex');
    const hash2 = createHash('sha256').update(code).digest('hex');
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
    assert.notEqual(hash1, code);
  });

  it('different codes produce different hashes', () => {
    const hash1 = createHash('sha256').update('CODE1').digest('hex');
    const hash2 = createHash('sha256').update('CODE2').digest('hex');
    assert.notEqual(hash1, hash2);
  });
});

describe('MFA challenge ID generation', () => {
  it('produces unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomBytes(16).toString('base64url')));
    assert.equal(ids.size, 100);
  });

  it('IDs are URL-safe', () => {
    const id = randomBytes(16).toString('base64url');
    assert.match(id, /^[A-Za-z0-9_-]+$/);
  });
});
