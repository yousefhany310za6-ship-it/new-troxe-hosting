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

function layout(title: string, body: string, footerExtra = ''): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0b0b10;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b10;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#14141c;border-radius:12px;padding:32px;color:#f2f2f5;">
<tr><td style="font-size:20px;font-weight:bold;color:#ffffff;">Troxe</td></tr>
<tr><td style="padding-top:16px;font-size:16px;font-weight:bold;color:#ffffff;">${title}</td></tr>
<tr><td style="padding-top:12px;font-size:14px;line-height:1.6;color:#c9c9d4;">${body}</td></tr>
${footerExtra}
<tr><td style="padding-top:24px;font-size:12px;color:#8a8a99;">Troxe Hosting — bot &amp; app hosting.<br/>If you did not expect this email, you can safely ignore it.</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function button(url: string, label: string): string {
  return `<p style="padding-top:8px;"><a href="${url}" style="display:inline-block;background:#ffffff;color:#000000;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 28px;border-radius:999px;">${label}</a></p>`;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

export function verificationEmail(name: string, code: string): BuiltEmail {
  const n = escapeHtml(name);
  const c = escapeHtml(code);
  const body = `<p>Hi ${n},</p><p>Use this code to verify your email address. It expires in <strong>10 minutes</strong>:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#ffffff;">${c}</p><p>If you did not create a Troxe account, ignore this email.</p>`;
  return {
    subject: 'Verify your Troxe email',
    html: layout('Verify your email', body),
    text: `Hi ${name},\n\nUse this code to verify your email address (expires in 10 minutes):\n\n${code}\n\nIf you did not create a Troxe account, ignore this email.`,
  };
}

export function passwordResetEmail(name: string, url: string): BuiltEmail {
  const n = escapeHtml(name);
  const u = escapeHtml(url);
  const body = `<p>Hi ${n},</p><p>Someone requested a password reset for your Troxe account. Click below — the link expires in <strong>1 hour</strong> and works once:</p>${button(u, 'Reset password')}<p style="font-size:12px;color:#8a8a99;">Or paste this link into your browser:<br/>${u}</p><p>If that was not you, your password is unchanged — but consider securing your account.</p>`;
  return {
    subject: 'Reset your Troxe password',
    html: layout('Reset your password', body),
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
    ? `${button(e(d.secureUrl), 'Secure my account')}<p style="font-size:12px;color:#8a8a99;">If this was you, no action is needed. If not, change your password immediately and review active sessions.</p>`
    : `<p style="font-size:12px;color:#8a8a99;">If this was you, no action is needed. If not, change your password immediately and review active sessions.</p>`;
  const body =
    `<p>Hi ${e(d.name)},</p><p>We noticed a sign-in to your Troxe account from a new location:</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;color:#c9c9d4;">` +
    rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#8a8a99;">${k}</td><td style="padding:4px 0;color:#ffffff;">${e(v)}</td></tr>`).join('') +
    `</table>${secure}`;
  return {
    subject: 'New sign-in to your Troxe account',
    html: layout('New sign-in detected', body),
    text:
      `Hi ${d.name},\n\nWe noticed a sign-in to your Troxe account from a new location:\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
      (d.secureUrl ? `\n\nSecure your account: ${d.secureUrl}` : '') +
      `\n\nIf this was you, no action is needed.`,
  };
}
