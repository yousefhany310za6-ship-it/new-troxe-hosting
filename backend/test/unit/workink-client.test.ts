import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  applyOverride,
  buildReturnUrl,
  parseOverride,
  parseTokenVerdict,
  parseWorkinkBaseUrl,
  plainLink,
  tokenCheckUrl,
  workinkReadiness,
  type WorkinkConfig,
} from '../../src/modules/servers/workink-client.ts';
import { validateTokenShape } from '../../src/modules/servers/renewal-policy.ts';

const cfg = (over: Partial<WorkinkConfig> = {}): WorkinkConfig => ({
  enabled: true,
  apiBaseUrl: 'https://work.ink/_api/v2',
  linkUrl: 'https://work.ink/aBcD/renew-server',
  linkId: '10345',
  returnUrlTemplate: 'https://hosting.troxe.dev/dashboard/renew?session={SESSION}&key={TOKEN}',
  deleteToken: true,
  ...over,
});

describe('Work.ink readiness is all-or-nothing', () => {
  it('accepts a fully configured integration', () => {
    assert.equal(workinkReadiness(cfg()).ready, true);
  });

  it('refuses when disabled', () => {
    const r = workinkReadiness(cfg({ enabled: false }));
    assert.equal(r.ready, false);
    assert.ok(r.missing.includes('WORKINK_ENABLED'));
  });

  it('names every missing piece so the operator can fix them', () => {
    const r = workinkReadiness(cfg({ linkId: '', linkUrl: '', returnUrlTemplate: '' }));
    assert.equal(r.ready, false);
    assert.deepEqual(r.missing.sort(), ['WORKINK_LINK_ID', 'WORKINK_LINK_URL', 'WORKINK_RETURN_URL']);
  });

  it('requires the {TOKEN} placeholder in the return URL', () => {
    const r = workinkReadiness(cfg({ returnUrlTemplate: 'https://hosting.troxe.dev/dashboard/renew' }));
    assert.equal(r.ready, false);
    assert.ok(r.missing.some((m) => m.includes('{TOKEN}')));
  });
});

describe('the return URL is ours, never the browser’s', () => {
  it('binds the session AND keeps the provider’s {TOKEN} placeholder', () => {
    const url = buildReturnUrl(cfg(), 'sess-123');
    // {TOKEN} MUST survive: Work.ink replaces it with the real key on
    // redirect. Stripping it (an earlier revision did) means the user comes
    // back with nothing and the renewal can never complete.
    assert.equal(url, 'https://hosting.troxe.dev/dashboard/renew?session=sess-123&key={TOKEN}');
    assert.ok(url.includes('sess-123'));
    assert.ok(url.includes('{TOKEN}'), 'the provider placeholder must not be removed');
    assert.ok(!url.includes('{SESSION}'));
  });

  it('encodes the session id — a hostile id cannot escape the query', () => {
    const url = buildReturnUrl(cfg(), 'a&b=c#d');
    assert.ok(url.includes('session=a%26b%3Dc%23d'), url);
    assert.ok(!url.includes('#d'), 'must not create a fragment');
  });

  it('never lets a caller choose the destination', () => {
    // the only input is OUR session uuid; the origin and path come from config
    const url = buildReturnUrl(cfg(), 'abc');
    assert.ok(url.startsWith('https://hosting.troxe.dev/'));
    assert.equal(new URL(url).host, 'hosting.troxe.dev');
  });

  it('tolerates a template with no {TOKEN} placeholder (override just won’t inject a key)', () => {
    const url = buildReturnUrl(cfg({ returnUrlTemplate: 'https://hosting.troxe.dev/dashboard/renew?session={SESSION}' }), 'x1');
    assert.equal(url, 'https://hosting.troxe.dev/dashboard/renew?session=x1');
  });

  it('a {TOKEN} template without {SESSION} still works (override-free flow)', () => {
    const url = buildReturnUrl(cfg({ returnUrlTemplate: 'https://hosting.troxe.dev/dashboard/renew?key={TOKEN}' }), 'x1');
    assert.equal(url, 'https://hosting.troxe.dev/dashboard/renew?key={TOKEN}');
  });
});

describe('the Work.ink redirect URL', () => {
  it('appends the signed override to the dashboard link', () => {
    const url = applyOverride(plainLink(cfg()), 'SIG/BLOB+1');
    assert.equal(url, 'https://work.ink/aBcD/renew-server?sr=SIG%2FBLOB%2B1');
  });

  it('uses & when the link already carries a query', () => {
    const url = applyOverride('https://work.ink/a/b?ref=x', 'SR');
    assert.equal(url, 'https://work.ink/a/b?ref=x&sr=SR');
  });

  it('never points anywhere but work.ink', () => {
    const url = applyOverride(plainLink(cfg()), 'SR');
    assert.equal(new URL(url).hostname, 'work.ink');
    assert.equal(new URL(url).protocol, 'https:');
  });

  it('carries only the two fields the browser needs', () => {
    const url = applyOverride(plainLink(cfg()), 'SR');
    // no key, no token, no api secret may appear in what the browser receives
    assert.ok(!url.toLowerCase().includes('apikey'));
    assert.ok(!url.toLowerCase().includes('secret'));
  });
});

describe('SSRF fence: only https work.ink is ever contacted', () => {
  it('accepts the official host', () => {
    assert.equal(parseWorkinkBaseUrl('https://work.ink/_api/v2').startsWith('https://work.ink/'), true);
    assert.equal(parseWorkinkBaseUrl('https://api.work.ink/_api/v2').startsWith('https://api.work.ink/'), true);
  });

  it('refuses another origin, a userinfo trick, and plain http', () => {
    for (const bad of [
      'https://evil.example/_api/v2',
      'https://work.ink.evil.example/_api/v2',
      'http://work.ink/_api/v2',
      'https://work.ink@evil.example/_api/v2',
      'file:///etc/passwd',
      'not a url',
    ]) {
      assert.throws(() => parseWorkinkBaseUrl(bad), /workink: refusing|not a valid URL/, bad);
    }
  });

  it('refuses a redirect-shaped destination from ever being requested', () => {
    // the URL builder always targets the allowlisted base; only the query
    // carries the destination, so it cannot become a host.
    const url = tokenCheckUrl(cfg(), 'abc', { consume: true });
    assert.ok(url.startsWith('https://work.ink/_api/v2/token/isValid/'));
    assert.equal(new URL(url).host, 'work.ink');
  });
});

describe('parsing Work.ink responses', () => {
  const NOW = new Date('2026-10-13T12:00:00.000Z');

  it('reads a documented valid response', () => {
    const v = parseTokenVerdict(
      {
        valid: true,
        deleted: false,
        info: {
          token: 'abc',
          createdAt: NOW.getTime() - 60_000,
          byIp: '1.2.3.4',
          linkId: 10345,
          expiresAfter: NOW.getTime() + 600_000,
        },
      },
      NOW,
    );
    assert.equal(v.kind, 'valid');
    if (v.kind === 'valid') {
      assert.equal(v.linkId, '10345');
      assert.equal(v.ip, '1.2.3.4');
      assert.ok(v.createdAt instanceof Date);
    }
  });

  it('treats the probed {"valid":false} as invalid, not as an error', () => {
    assert.equal(parseTokenVerdict({ valid: false }, NOW).kind, 'invalid');
  });

  it('REFUSES valid:true with no linkId — no provenance, no renewal', () => {
    assert.equal(parseTokenVerdict({ valid: true, info: {} }, NOW).kind, 'error');
    assert.equal(parseTokenVerdict({ valid: true }, NOW).kind, 'error');
  });

  it('honours the provider’s own expiry', () => {
    const v = parseTokenVerdict(
      { valid: true, info: { linkId: 1, expiresAfter: NOW.getTime() - 1 } },
      NOW,
    );
    assert.equal(v.kind, 'expired');
  });

  it('parses the REAL response Work.ink returned for a live key', () => {
    // Captured verbatim from production on 2026-10-13, so this locks in the
    // actual wire shape — including `userId`, which is NOT in the docs example.
    const real = {
      valid: true,
      deleted: false,
      info: {
        token: '4acee70a-ff21-4504-b04f-ea61a1f3a67d',
        createdAt: 1791862440636,
        byIp: '197.51.193.142',
        linkId: 5042641,
        userId: null,
        expiresAfter: 1791862740635,
      },
    };
    const v = parseTokenVerdict(real, new Date(1791862440000));
    assert.equal(v.kind, 'valid');
    if (v.kind === 'valid') {
      assert.equal(v.linkId, '5042641', 'linkId arrives as a NUMBER, not a string');
      assert.equal(v.ip, '197.51.193.142');
    }
    // the documented key lifetime, measured rather than assumed
    assert.equal(real.info.expiresAfter - real.info.createdAt, 299_999);
  });

  it('accepts the real key format (a UUID) through shape validation', () => {
    const r = validateTokenShape('4acee70a-ff21-4504-b04f-ea61a1f3a67d');
    assert.equal(r.ok, true, 'a real Work.ink key must survive shape validation');
  });

  it('still refuses a real-shaped key when it carries no provenance', () => {
    const v = parseTokenVerdict(
      { valid: true, deleted: false, info: { token: '4acee70a-ff21-4504-b04f-ea61a1f3a67d' } },
      new Date(),
    );
    assert.equal(v.kind, 'error', 'a uuid alone proves nothing — linkId is mandatory');
  });

  it('treats garbage, null and arrays as an error — never as success', () => {
    for (const body of [null, undefined, 'ok', 42, [], { valid: 'true' }]) {
      assert.equal(parseTokenVerdict(body, NOW).kind, 'error', JSON.stringify(body));
    }
  });

  it('bounds a hostile byIp before it reaches the database', () => {
    const v = parseTokenVerdict({ valid: true, info: { linkId: 1, byIp: 'x'.repeat(500) } }, NOW);
    assert.equal(v.kind, 'valid');
    if (v.kind === 'valid') assert.equal((v.ip ?? '').length, 45);
  });

  it('reads a signed override and rejects an unusable one', () => {
    assert.equal(parseOverride({ sr: 'SIGBLOB' }), 'SIGBLOB');
    assert.equal(parseOverride({}), null);
    assert.equal(parseOverride({ sr: 42 }), null);
    assert.equal(parseOverride({ sr: 'x'.repeat(600) }), null);
  });

  it('puts the key in a path segment, never in the query', () => {
    const url = tokenCheckUrl(cfg(), 'abc/../def', { consume: false });
    assert.ok(url.includes('abc%2F..%2Fdef'), url);
    assert.ok(!url.split('?')[0].includes('/../'), 'path traversal must be encoded');
  });

  it('adds deleteToken=1 only when configured', () => {
    assert.ok(tokenCheckUrl(cfg(), 'k', { consume: true }).endsWith('?deleteToken=1'));
    assert.ok(!tokenCheckUrl(cfg({ deleteToken: false }), 'k', { consume: true }).includes('deleteToken'));
  });
});