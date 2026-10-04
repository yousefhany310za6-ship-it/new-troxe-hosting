import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildSendPayload, sendError, validateSendOpts, type SendOpts } from '../../src/modules/email/email.send.ts';
import { sanitizeCampaignHtml } from '../../src/modules/email/email.templates.ts';

function codeOf(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => 'NO_THROW',
    (e) => (e as { getResponse?: () => { code?: string } }).getResponse?.().code ?? 'NO_CODE',
  );
}

const base: SendOpts = { to: 'a@b.c', subject: 'Hi', html: '<p>x</p>', kind: 'verification' };

describe('validateSendOpts', () => {
  it('accepts a well-formed send', () => {
    assert.doesNotThrow(() => validateSendOpts(base));
  });
  it('rejects bad recipients, subjects, bodies and missing unsubscribe', async () => {
    assert.equal(await codeOf((async () => validateSendOpts({ ...base, to: 'nope' }))()), 'EMAIL_INVALID');
    assert.equal(await codeOf((async () => validateSendOpts({ ...base, subject: '' }))()), 'EMAIL_SUBJECT');
    assert.equal(await codeOf((async () => validateSendOpts({ ...base, html: '' }))()), 'EMAIL_BODY');
    assert.equal(
      await codeOf((async () => validateSendOpts({ ...base, kind: 'promotional' }))()),
      'EMAIL_UNSUBSCRIBE_REQUIRED',
    );
    assert.doesNotThrow(() =>
      validateSendOpts({ ...base, kind: 'promotional', unsubscribeUrl: 'https://x/u?t=1' }),
    );
  });
});

describe('buildSendPayload', () => {
  it('carries headers and idempotency through, never secrets', () => {
    const p = buildSendPayload('Troxe <n@x.io>', { ...base, kind: 'promotional', unsubscribeUrl: 'https://x/u', idempotencyKey: 'c:1:u:2' }, { 'X-Troxe-Kind': 'promotional', 'List-Unsubscribe': '<https://x/u>' });
    assert.equal(p.from, 'Troxe <n@x.io>');
    assert.equal(p.headers['List-Unsubscribe'], '<https://x/u>');
    assert.equal(p.idempotencyKey, 'c:1:u:2');
    assert.ok(!JSON.stringify(p).includes('RESEND') && !JSON.stringify(p).includes('re_'));
  });
  it('omits the idempotency key when absent', () => {
    const p = buildSendPayload('T <n@x.io>', base, {});
    assert.ok(!('idempotencyKey' in p));
  });
});

describe('sendError', () => {
  it('maps anything to generic EMAIL_UPSTREAM without internals', () => {
    try {
      sendError(new Error('Invalid API key secret-internal-xyz'));
      assert.fail('must throw');
    } catch (e) {
      const r = (e as { getResponse?: () => { code?: string; message?: string } }).getResponse?.();
      assert.equal(r?.code, 'EMAIL_UPSTREAM');
      assert.ok(!(r?.message ?? '').includes('secret-internal-xyz'));
    }
  });
});

describe('sanitizeCampaignHtml', () => {
  it('strips scripts, iframes, handlers and javascript: URLs, keeps content', () => {
    const dirty =
      '<p>Hi</p><script>alert(1)</script><iframe src="https://evil.example"></iframe>' +
      '<a href="javascript:alert(2)" onclick="x()">x</a><a href="https://good.example">y</a>' +
      '<img src="https://good.example/i.png" onerror="x()"/>';
    const clean = sanitizeCampaignHtml(dirty);
    assert.ok(!clean.includes('<script') && !clean.includes('<iframe') && !clean.includes('javascript:'));
    assert.ok(!clean.includes('onclick') && !clean.includes('onerror'));
    assert.ok(clean.includes('https://good.example') && clean.includes('<p>Hi</p>'));
  });
  it('rejects oversized input', () => {
    assert.throws(() => sanitizeCampaignHtml('x'.repeat(300 * 1024)), /CAMPAIGN_HTML_TOO_LARGE/);
  });
});
