import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  discordAvatarUrl,
  googleAvatarOk,
  httpsUrlOk,
  isOAuthProvider,
  newCodeVerifier,
  newStateValue,
  OAUTH_LINK_TOKEN_TTL_SEC,
  OAUTH_STATE_TTL_SEC,
  pkceChallenge,
  sanitizeNext,
  signLinkToken,
  signState,
  verifyLinkToken,
  verifyState,
} from '../../src/modules/auth/oauth/oauth.helpers.ts';

void OAUTH_LINK_TOKEN_TTL_SEC;
void OAUTH_STATE_TTL_SEC;

const SECRET = 'test-secret-that-is-long-enough-for-hmac-use-0123456789';

describe('sanitizeNext', () => {
  it('accepts plain relative paths', () => {
    assert.equal(sanitizeNext('/dashboard'), '/dashboard');
    assert.equal(sanitizeNext('/dashboard/servers?x=1#f'), '/dashboard/servers?x=1#f');
    assert.equal(sanitizeNext('/signin'), '/signin');
  });
  it('rejects absolute URLs, protocol-relative and escapes', () => {
    assert.equal(sanitizeNext('https://evil.example/x'), '/dashboard');
    assert.equal(sanitizeNext('http://evil.example'), '/dashboard');
    assert.equal(sanitizeNext('//evil.example/x'), '/dashboard');
    assert.equal(sanitizeNext('/\\evil'), '/dashboard');
    assert.equal(sanitizeNext('/a\r\nb'), '/dashboard');
    assert.equal(sanitizeNext('javascript:alert(1)'), '/dashboard');
    assert.equal(sanitizeNext(''), '/dashboard');
    assert.equal(sanitizeNext(undefined), '/dashboard');
    assert.equal(sanitizeNext(null), '/dashboard');
    assert.equal(sanitizeNext(42), '/dashboard');
    assert.equal(sanitizeNext('/' + 'a'.repeat(600)), '/dashboard');
  });
});

describe('pkce', () => {
  it('challenge is the S256 of the verifier', async () => {
    const { createHash } = await import('node:crypto');
    const v = newCodeVerifier();
    assert.match(v, /^[A-Za-z0-9_-]+$/);
    assert.equal(pkceChallenge(v), createHash('sha256').update(v, 'utf8').digest('base64url'));
  });
});

describe('state tokens', () => {
  const base = {
    s: newStateValue(),
    p: 'google' as const,
    m: 'login' as const,
    n: '/dashboard',
    cv: newCodeVerifier(),
    exp: Math.floor(Date.now() / 1000) + 600,
  };
  it('round-trips a login state', () => {
    const t = signState(base, SECRET);
    const got = verifyState(t, SECRET, 'google');
    assert.ok(got);
    assert.equal(got?.s, base.s);
    assert.equal(got?.n, '/dashboard');
  });
  it('rejects tampering, wrong provider, wrong secret and expiry', () => {
    const t = signState(base, SECRET);
    assert.equal(verifyState(t.slice(0, -1) + (t.endsWith('0') ? '1' : '0'), SECRET, 'google'), null);
    assert.equal(verifyState(t, SECRET, 'discord'), null);
    assert.equal(verifyState(t, SECRET + 'x', 'google'), null);
    assert.equal(verifyState('garbage', SECRET, 'google'), null);
    const expired = signState({ ...base, exp: Math.floor(Date.now() / 1000) - 1 }, SECRET);
    assert.equal(verifyState(expired, SECRET, 'google'), null);
  });
  it('link mode requires a user id', () => {
    const noUser = signState({ ...base, m: 'link' } as never, SECRET);
    assert.equal(verifyState(noUser, SECRET, 'google'), null);
    const okLink = signState({ ...base, m: 'link', u: 'user-1' }, SECRET);
    assert.equal(verifyState(okLink, SECRET, 'google')?.u, 'user-1');
  });
  it('link tokens bind uid+provider+puid and expire', () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const t = signLinkToken({ uid: 'u1', p: 'discord', puid: '123', em: 'a@b.c', ev: true, av: null, exp }, SECRET);
    const got = verifyLinkToken(t, SECRET);
    assert.ok(got && got.uid === 'u1' && got.p === 'discord' && got.puid === '123' && got.em === 'a@b.c' && got.ev === true);
    // a state token is never accepted as a link token (context separation)
    assert.equal(verifyLinkToken(signState(base, SECRET), SECRET), null);
    assert.equal(verifyLinkToken(t, SECRET + 'x'), null);
    assert.equal(verifyLinkToken(signLinkToken({ uid: 'u1', p: 'discord', puid: '1', em: null, ev: 'yes' as never, av: null, exp }, SECRET), SECRET), null);
  });
});

describe('googleAvatarOk', () => {
  it('accepts google image hosts over https only', () => {
    assert.equal(googleAvatarOk('https://lh3.googleusercontent.com/a/x=s96-c'), 'https://lh3.googleusercontent.com/a/x=s96-c');
    assert.equal(googleAvatarOk('http://lh3.googleusercontent.com/a'), null);
    assert.equal(googleAvatarOk('https://evil.example/a.png'), null);
    assert.equal(googleAvatarOk('https://lh3.googleusercontent.com.evil.example/a'), null);
    assert.equal(googleAvatarOk('https://user:pass@lh3.googleusercontent.com/a'), null);
    assert.equal(googleAvatarOk(null), null);
    assert.equal(googleAvatarOk('not a url'), null);
  });
});

describe('discordAvatarUrl', () => {
  it('builds custom avatar urls, gif for animated', () => {
    const h = 'a'.repeat(32);
    assert.equal(
      discordAvatarUrl('123456789012345678', h),
      `https://cdn.discordapp.com/avatars/123456789012345678/${h}.png?size=256`,
    );
    const ah = 'a_' + 'b'.repeat(30);
    assert.ok(discordAvatarUrl('123456789012345678', ah)?.endsWith('.gif?size=256'));
  });
  it('falls back to default avatars', () => {
    // new username system (discriminator "0"): (id >> 22) % 6
    const d0 = discordAvatarUrl('123456789012345678', null, '0');
    assert.ok(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/.test(d0 ?? ''));
    // legacy discriminator
    assert.equal(discordAvatarUrl('123456789012345678', null, '7'), 'https://cdn.discordapp.com/embed/avatars/2.png');
    assert.equal(discordAvatarUrl('123456789012345678', undefined), d0);
  });
  it('rejects malformed ids and hashes', () => {
    assert.equal(discordAvatarUrl('notanid', 'a'.repeat(32)), null);
    assert.equal(discordAvatarUrl('123456789012345678', 'xyz'), discordAvatarUrl('123456789012345678', null, '0'));
  });
});

describe('httpsUrlOk', () => {
  it('accepts https urls, rejects the rest', () => {
    assert.equal(httpsUrlOk('https://example.com/a.png'), 'https://example.com/a.png');
    assert.equal(httpsUrlOk('http://example.com/a.png'), null);
    assert.equal(httpsUrlOk('data:image/png;base64,xx'), null);
    assert.equal(httpsUrlOk('x'.repeat(3000)), null);
  });
});

describe('isOAuthProvider', () => {
  it('narrows correctly', () => {
    assert.equal(isOAuthProvider('google'), true);
    assert.equal(isOAuthProvider('discord'), true);
    assert.equal(isOAuthProvider('github'), false);
  });
});
