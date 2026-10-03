import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { discordProfile, googleProfile } from '../../src/modules/auth/oauth/oauth.providers.ts';
import { ensureGuildMember } from '../../src/modules/auth/oauth/discord-guild.service.ts';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockFetch(handler: Handler): typeof fetch {
  return ((url: unknown, init?: RequestInit) => handler(String(url), init)) as typeof fetch;
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const CFG = { clientId: 'cid', clientSecret: 'csec', redirectUri: 'https://api.example.com/api/v1/auth/oauth/x/callback' };

function errCode(e: unknown): string {
  const r = (e as { getResponse?: () => unknown })?.getResponse?.();
  return (r as { code?: string })?.code ?? '';
}

async function rejectsUpstream(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (e) {
    assert.equal(errCode(e), 'OAUTH_UPSTREAM');
    return;
  }
  assert.fail('expected OAUTH_UPSTREAM rejection');
}

describe('googleProfile', () => {
  it('parses a new user (verified email + avatar)', async () => {
    const f = mockFetch((url) =>
      String(url).includes('/token')
        ? json({ access_token: 'tok', token_type: 'Bearer' })
        : json({ sub: 'g123', email: 'User@Example.com', email_verified: true, name: '  Ada  Lovelace  ', picture: 'https://lh3.googleusercontent.com/a/pic' }),
    );
    const { profile, userAccessToken } = await googleProfile('code', 'verifier', CFG, f);
    assert.equal(userAccessToken, 'tok');
    assert.equal(profile.providerUserId, 'g123');
    assert.equal(profile.email, 'user@example.com');
    assert.equal(profile.emailVerified, true);
    assert.equal(profile.name, 'Ada Lovelace');
    assert.equal(profile.avatarUrl, 'https://lh3.googleusercontent.com/a/pic');
  });
  it('distrusts unverified emails and off-host pictures', async () => {
    const f = mockFetch((url) =>
      String(url).includes('/token')
        ? json({ access_token: 'tok', token_type: 'Bearer' })
        : json({ sub: 'g9', email: 'x@y.z', email_verified: false, name: 'X', picture: 'https://evil.example/a.png' }),
    );
    const { profile } = await googleProfile('code', 'verifier', CFG, f);
    assert.equal(profile.emailVerified, false);
    assert.equal(profile.avatarUrl, null);
    assert.equal(profile.name, 'Troxe User'); // single-char names fall back
  });
  it('existing-user shape and failure mapping', async () => {
    const f = mockFetch((url) =>
      String(url).includes('/token')
        ? json({ access_token: 'tok', token_type: 'Bearer' })
        : json({ sub: 'g1', email_verified: true, name: 'Bo', picture: null }),
    );
    const { profile } = await googleProfile('code', 'verifier', CFG, f);
    assert.equal(profile.email, null);
    assert.equal(profile.emailVerified, false);
    assert.equal(profile.avatarUrl, null);
  });
  it('maps provider failures to OAUTH_UPSTREAM, not raw errors', async () => {
    const denied = mockFetch(() => json({ error: 'invalid_grant' }, 400));
    await rejectsUpstream(googleProfile('code', 'v', CFG, denied));
    const broken = mockFetch(() => new Response('not json', { status: 200 }));
    await rejectsUpstream(googleProfile('code', 'v', CFG, broken));
    const nosub = mockFetch((url) => (String(url).includes('/token') ? json({ access_token: 't' }) : json({})));
    await rejectsUpstream(googleProfile('code', 'v', CFG, nosub));
    const down: typeof fetch = (() => Promise.reject(new Error('boom'))) as typeof fetch;
    await rejectsUpstream(googleProfile('code', 'v', CFG, down));
  });
});

describe('discordProfile', () => {
  it('parses id, global_name, animated avatar and verified email', async () => {
    const av = 'a_' + 'c'.repeat(30);
    const f = mockFetch((url) =>
      String(url).includes('/oauth2/token')
        ? json({ access_token: 'dtok', token_type: 'Bearer' })
        : json({ id: '123456789012345678', username: 'oldname', global_name: 'New Name', discriminator: '0', avatar: av, email: 'd@x.io', verified: true }),
    );
    const { profile } = await discordProfile('code', 'v', CFG, f);
    assert.equal(profile.providerUserId, '123456789012345678');
    assert.equal(profile.name, 'New Name');
    assert.equal(profile.email, 'd@x.io');
    assert.equal(profile.emailVerified, true);
    assert.ok(profile.avatarUrl?.endsWith('.gif?size=256'));
  });
  it('handles missing custom avatar and unverified/missing email', async () => {
    const f = mockFetch((url) =>
      String(url).includes('/oauth2/token')
        ? json({ access_token: 'dtok', token_type: 'Bearer' })
        : json({ id: '123456789012345678', username: 'ab', discriminator: '0', avatar: null, email: null }),
    );
    const { profile } = await discordProfile('code', 'v', CFG, f);
    assert.ok(profile.avatarUrl?.includes('/embed/avatars/'));
    assert.equal(profile.email, null);
    assert.equal(profile.name, 'ab');
  });
  it('rejects malformed ids', async () => {
    const f = mockFetch((url) => (String(url).includes('/oauth2/token') ? json({ access_token: 't' }) : json({ id: 'nope' })));
    await rejectsUpstream(discordProfile('code', 'v', CFG, f));
  });
});

describe('ensureGuildMember', () => {
  const base = { botToken: 'bot', guildId: '999', userId: '123456789012345678', userAccessToken: 'u-at', alreadyJoinedAt: null as Date | null };
  it('already inside → no PUT, marked joined', async () => {
    let puts = 0;
    const f = mockFetch((url, init) => {
      if ((init?.method ?? 'GET') !== 'GET') puts++;
      return json({ user: {} }, 200);
    });
    const r = await ensureGuildMember({ ...base, fetchImpl: f });
    assert.equal(r.status, 'already');
    assert.equal(puts, 0);
  });
  it('not inside → exactly one PUT with the user token', async () => {
    const seen: Array<{ method: string; body: string; auth: string }> = [];
    const f = mockFetch((url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return json({ message: 'Unknown Member' }, 404);
      seen.push({ method, body: String(init?.body), auth: String((init?.headers as Record<string, string>)?.Authorization) });
      return new Response(null, { status: 201 });
    });
    const r = await ensureGuildMember({ ...base, fetchImpl: f });
    assert.equal(r.status, 'joined');
    assert.equal(seen.length, 1);
    assert.ok(seen[0].body.includes('u-at'));
    assert.ok(seen[0].auth.startsWith('Bot '));
    assert.ok(!seen[0].body.includes('bot'));
  });
  it('denied permission → failed, never fatal', async () => {
    const f = mockFetch((url, init) => ((init?.method ?? 'GET') === 'GET' ? json({}, 404) : json({}, 403)));
    const r = await ensureGuildMember({ ...base, fetchImpl: f });
    assert.equal(r.status, 'failed');
  });
  it('user not inside and guild rate-limits → failed rate_limited', async () => {
    const f = mockFetch(() => json({}, 429));
    const r = await ensureGuildMember({ ...base, fetchImpl: f });
    assert.deepEqual(r, { status: 'failed', reason: 'rate_limited' });
  });
  it('recently joined → cached without any HTTP', async () => {
    let calls = 0;
    const f = mockFetch(() => {
      calls++;
      return json({});
    });
    const r = await ensureGuildMember({ ...base, alreadyJoinedAt: new Date(), fetchImpl: f });
    assert.equal(r.status, 'cached');
    assert.equal(calls, 0);
  });
  it('disabled without bot credentials; network errors are failures', async () => {
    const r1 = await ensureGuildMember({ ...base, botToken: '', fetchImpl: mockFetch(() => json({})) });
    assert.equal(r1.status, 'disabled');
    const down: typeof fetch = (() => Promise.reject(new Error('x'))) as typeof fetch;
    const r2 = await ensureGuildMember({ ...base, fetchImpl: down });
    assert.equal(r2.status, 'failed');
  });
});
