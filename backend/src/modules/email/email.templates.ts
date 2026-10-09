/**
 * Email templates. Every message the platform sends is built here — no
 * controller or auth service concatenates HTML by hand.
 *
 * Safety rules:
 * - all interpolated values go through `escapeHtml` (recipient names are
 *   user input and must never break out of the markup);
 * - campaign templates use `renderSafe`, which substitutes ONLY an explicit
 *   allowlist (`user.name`, `user.email`, `app.name`) and drops anything
 *   else — no eval, no Function, no code execution of any kind;
 * - admin-authored campaign HTML passes through `sanitizeCampaignHtml`
 *   (sanitize-html allowlist: text markup + links + images + plain inline
 *   styles only — no scripts, iframes, forms, event handlers, or
 *   javascript:/data: URLs) before sending;
 * - no JavaScript, no remote content except explicit image URLs, table
 *   layout for client compatibility.
 */
import sanitizeHtml from 'sanitize-html';
import { Err } from '../../common/errors';

/** Admin-authored campaign HTML, reduced to a safe email subset. */
export function sanitizeCampaignHtml(html: string): string {
  if (typeof html !== 'string' || html.length > 256 * 1024) throw Err.invalid('CAMPAIGN_HTML_TOO_LARGE');
  return sanitizeHtml(html, {
    allowedTags: [
      'a', 'b', 'i', 'u', 's', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4',
      'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'span', 'strong', 'em',
      'blockquote', 'hr', 'img', 'center', 'font',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'width', 'height'],
      '*': ['align', 'color', 'bgcolor', 'width', 'height', 'cellpadding', 'cellspacing', 'border', 'style'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(/, /^rgba\(/],
        'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(/, /^rgba\(/],
        'font-size': [/^\d+(px|pt|em|%)$/],
        'text-align': [/^(left|center|right|justify)$/],
        padding: [/^[\dpx\s%]+$/],
        margin: [/^[\dpx\s%]+$/],
      },
    },
  });
}

export function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SAFE_VARS: Record<string, (u: { name: string; email: string }, appName: string) => string> = {
  'user.name': (u) => u.name,
  'user.email': (u) => u.email,
  'app.name': (_u, appName) => appName,
};

/**
 * Substitute `{{var}}` from the allowlist only. Unknown placeholders are
 * removed (never echoed back), values are HTML-escaped.
 *
 * The lookup MUST be own-property based: `SAFE_VARS['constructor']` would
 * otherwise resolve through the prototype chain.
 */
export function renderSafe(template: string, user: { name: string; email: string }, appName: string): string {
  const once = template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(SAFE_VARS, key)) return '';
    return escapeHtml(SAFE_VARS[key](user, appName));
  });
  // anything that is not a plain allowlisted token (method calls, filters,
  // typos) is stripped rather than echoed back into the mail
  return once.replace(/\{\{[^{}]{1,64}\}\}/g, '');
}

/**
 * Same allowlist as renderSafe but WITHOUT HTML-escaping — for plain-text
 * subjects and text fallbacks, where entities would corrupt the output.
 */
export function renderText(template: string, user: { name: string; email: string }, appName: string): string {
  const once = template.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(SAFE_VARS, key)) return '';
    return SAFE_VARS[key](user, appName);
  });
  return once.replace(/\{\{[^{}]{1,64}\}\}/g, '');
}

/** Strip tags for the plain-text fallback of marketing mail. */export function htmlToText(html: string): string {
  return html
    .replace(/<\/?(br|p|div|h[1-6]|li|tr|ul|ol|table)[^>]*>/gi, '\n')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const t = inner.replace(/<[^>]*>/g, '').trim();
      if (!t) return href;
      if (t.includes(href)) return t;
      return `${t} (${href})`;
    })
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function layout(title: string, body: string, opts: { preheader?: string; eyebrow?: string } = {}): string {
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${opts.preheader}</div>`
    : '';
  const eyebrow = opts.eyebrow
    ? `<tr><td style="padding:24px 36px 0 36px;"><span style="display:inline-block;font-size:11px;font-weight:bold;letter-spacing:2px;color:#a1a1aa;border:1px solid #2a2a33;border-radius:999px;padding:5px 12px;">${opts.eyebrow}</span></td></tr>`
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#050507;font-family:Arial,Helvetica,sans-serif;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050507;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#101014;border:1px solid #23232b;border-radius:16px;">
<tr><td style="padding:32px 36px 0 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:15px;font-weight:bold;letter-spacing:3px;color:#ffffff;">&#9632; TROXE</td>
<td align="right" style="font-size:11px;letter-spacing:1px;color:#71717a;">HOSTING</td>
</tr></table>
</td></tr>
${eyebrow}
<tr><td style="padding:4px 36px 0 36px;font-size:22px;font-weight:bold;color:#ffffff;">${title}</td></tr>
<tr><td style="padding:14px 36px 0 36px;font-size:14px;line-height:1.7;color:#c9c9d4;">${body}</td></tr>
<tr><td style="padding:28px 36px 0 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #23232b;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:16px 36px 32px 36px;font-size:12px;line-height:1.6;color:#71717a;">Troxe Hosting — bots &amp; apps, deployed in minutes.<br/>This mailbox isn&apos;t monitored, so please don&apos;t reply.<br/>&copy; 2026 Troxe Hosting</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function button(url: string, label: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:20px 0 8px 0;"><tr><td align="center"><a href="${url}" style="display:inline-block;background:#ffffff;color:#000000;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 40px;border-radius:12px;">${label}</a></td></tr></table>`;
}

function callout(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding-top:16px;"><tr><td style="border-left:2px solid #ffffff;background:#ffffff0d;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;line-height:1.6;color:#c9c9d4;">${text}</td></tr></table>`;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

export function verificationEmail(name: string, code: string): BuiltEmail {
  const n = escapeHtml(name);
  const c = escapeHtml(code);
  const body =
    `<p style="margin:0;">Hi ${n},</p>` +
    `<p>Enter this code to verify your email address:</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:8px 0 4px 0;"><tr><td align="center" style="background:#050507;border:1px solid #2a2a33;border-radius:12px;padding:20px 16px;font-size:32px;font-weight:bold;letter-spacing:10px;color:#ffffff;">${c}</td></tr></table>` +
    callout('This code expires in <strong>10 minutes</strong>. If you did not create a Troxe account, ignore this email.');
  return {
    subject: 'Verify your Troxe email',
    html: layout('Verify your email', body, { preheader: `Your Troxe verification code: ${code}`, eyebrow: 'EMAIL VERIFICATION' }),
    text: `Hi ${name},\n\nUse this code to verify your email address (expires in 10 minutes):\n\n${code}\n\nIf you did not create a Troxe account, ignore this email.`,
  };
}

export function passwordResetEmail(name: string, url: string): BuiltEmail {
  const n = escapeHtml(name);
  const u = escapeHtml(url);
  const body =
    `<p style="margin:0;">Hi ${n},</p>` +
    `<p>Someone requested a password reset for your Troxe account. Use the button below to choose a new password:</p>` +
    button(u, 'Reset password') +
    `<p style="font-size:12px;color:#71717a;">Button not working? Paste this link into your browser:<br/><span style="color:#a1a1aa;word-break:break-all;">${u}</span></p>` +
    callout('This link expires in <strong>1 hour</strong> and works once. If that was not you, your password is unchanged — but consider securing your account.');
  return {
    subject: 'Reset your Troxe password',
    html: layout('Reset your password', body, { preheader: 'Reset your Troxe password — expires in 1 hour', eyebrow: 'SECURITY' }),
    text: `Hi ${name},\n\nReset your Troxe password (expires in 1 hour, single use):\n\n${url}\n\nIf that was not you, your password is unchanged.`,
  };
}

export interface LoginDetails {
  name: string;
  ip: string;
  date: string;
  browser: string;
  os: string;
  device: string;
  method: string;
  secureUrl: string;
}

export function newLoginEmail(d: LoginDetails): BuiltEmail {
  const e = escapeHtml;
  const rows: Array<[string, string]> = [
    ['IP address', d.ip],
    ['Date', d.date],
    ['Browser', d.browser],
    ['OS', d.os],
    ['Device', d.device],
    ['Sign-in method', d.method],
  ];
  const secure = d.secureUrl
    ? `${button(e(d.secureUrl), 'Secure my account')}<p style="font-size:12px;color:#71717a;">If this was you, no action is needed. If not, change your password immediately and review your active sessions.</p>`
    : `<p style="font-size:12px;color:#71717a;">If this was you, no action is needed. If not, change your password immediately and review your active sessions.</p>`;
  const body =
    `<p style="margin:0;">Hi ${e(d.name)},</p><p>We noticed a sign-in to your Troxe account from a new location:</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050507;border:1px solid #2a2a33;border-radius:12px;font-size:14px;color:#c9c9d4;">` +
    rows.map(([k, v], i) => `<tr><td style="padding:10px 0 10px 16px;color:#71717a;${i > 0 ? 'border-top:1px solid #1c1c22;' : ''}">${k}</td><td align="right" style="padding:10px 16px 10px 0;color:#ffffff;font-weight:bold;${i > 0 ? 'border-top:1px solid #1c1c22;' : ''}">${e(v)}</td></tr>`).join('') +
    `</table>${secure}`;
  return {
    subject: 'New sign-in to your Troxe account',
    html: layout('New sign-in detected', body, { preheader: `New sign-in from ${e(d.ip)} — secure your account if this was not you`, eyebrow: 'SECURITY ALERT' }),
    text:
      `Hi ${d.name},\n\nWe noticed a sign-in to your Troxe account from a new location:\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
      (d.secureUrl ? `\n\nSecure your account: ${d.secureUrl}` : '') +
      `\n\nIf this was you, no action is needed.`,
  };
}
