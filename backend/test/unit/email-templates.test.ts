import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { escapeHtml, htmlToText, newLoginEmail, passwordResetEmail, renderSafe, verificationEmail } from '../../src/modules/email/email.templates.ts';
import { parseUserAgent } from '../../src/modules/email/useragent.ts';

describe('escapeHtml', () => {
  it('neutralizes markup in user input', () => {
    assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(escapeHtml('"q\'&'), '&quot;q&#39;&amp;');
    assert.equal(escapeHtml(null), '');
  });
});

describe('renderSafe', () => {
  const u = { name: 'Ada <b>', email: 'a@b.c' };
  it('substitutes only allowlisted variables, escaped', () => {
    assert.equal(
      renderSafe('Hi {{user.name}} ({{user.email}}) from {{app.name}}!', u, 'Troxe'),
      'Hi Ada &lt;b&gt; (a@b.c) from Troxe!',
    );
  });
  it('drops unknown placeholders and never executes anything', () => {
    assert.equal(renderSafe('{{evil}} {{constructor}} {{__proto__}}', u, 'T'), '  ');
    assert.equal(renderSafe('{{user.name.toUpperCase()}} {{user.name | upper}}', u, 'T'), ' ');
    assert.equal(renderSafe('{{user.name}}{{user.name}}', u, 'T'), 'Ada &lt;b&gt;Ada &lt;b&gt;');
  });
});

describe('verificationEmail', () => {
  it('embeds the code and expiry, escapes the name', () => {
    const t = verificationEmail('<img>', '123456');
    assert.ok(t.subject.length > 0);
    assert.ok(t.html.includes('123456') && t.html.includes('10 minutes'));
    assert.ok(!t.html.includes('<img>') && t.text.includes('123456'));
  });
});

describe('passwordResetEmail', () => {
  it('contains the reset link twice (button + fallback text)', () => {
    const t = passwordResetEmail('Bo', 'https://troxe.net/reset-password?token=abc');
    assert.ok(t.html.includes('https://troxe.net/reset-password?token=abc'));
    assert.ok(t.text.includes('https://troxe.net/reset-password?token=abc'));
  });
});

describe('newLoginEmail', () => {
  it('renders every detail row, escaped', () => {
    const t = newLoginEmail({
      name: 'C', ip: '1.2.3.4', date: 'October 4, 2026', browser: 'Chrome 120',
      os: 'Android', device: 'Mobile', method: 'password', secureUrl: 'https://x/s',
    });
    for (const s of ['1.2.3.4', 'Chrome 120', 'Android', 'Mobile', 'password']) assert.ok(t.html.includes(s));
    assert.ok(t.text.includes('1.2.3.4'));
  });
});

describe('htmlToText', () => {
  it('strips tags and keeps link targets', () => {
    assert.equal(htmlToText('<p>Hi</p><a href="https://x.io">click</a>'), 'Hi\nclick (https://x.io)');
  });
});

describe('parseUserAgent', () => {
  it('identifies common browsers, OSes and devices', () => {
    const chrome = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    assert.deepEqual(chrome, { browser: 'Chrome 120', os: 'Windows 10/11', device: 'Desktop' });
    const ios = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1');
    assert.deepEqual(ios, { browser: 'Safari 17', os: 'iOS 17.2', device: 'Mobile' });
    const ff = parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0');
    assert.deepEqual(ff, { browser: 'Firefox 121', os: 'Linux', device: 'Desktop' });
    const edge = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0');
    assert.equal(edge.browser, 'Edge 120');
    const droid = parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
    assert.deepEqual(droid.device, 'Mobile');
    assert.equal(droid.os, 'Android 14');
  });
  it('degrades to Unknown on garbage', () => {
    assert.deepEqual(parseUserAgent('curl/8.0'), { browser: 'Unknown', os: 'Unknown', device: 'Desktop' });
    assert.deepEqual(parseUserAgent(null), { browser: 'Unknown', os: 'Unknown', device: 'Unknown' });
    assert.deepEqual(parseUserAgent('x'.repeat(5000)).browser, 'Unknown');
  });
});
