import { Body, Controller, Get, Header, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { ctxOf } from '../../common/request-context';
import { UsersService } from './users.service';

class UnsubscribeDto {
  @IsString()
  @MaxLength(1024)
  token!: string;
}

const page = (title: string, body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title></head>` +
  `<body style="margin:0;background:#0b0b10;font-family:Arial,Helvetica,sans-serif;color:#f2f2f5;">` +
  `<div style="max-width:560px;margin:64px auto;padding:32px;background:#14141c;border-radius:12px;text-align:center;">` +
  `<div style="font-size:20px;font-weight:bold;">Troxe</div><h1 style="font-size:18px;">${title}</h1>${body}</div></body></html>`;

/**
 * One-click marketing unsubscribe. Public by necessity (clicked from an
 * inbox, no session): the HMAC token is the entire credential, it only ever
 * flips marketing mail off, and GET only renders a confirmation form — the
 * state change happens on POST (email-client prefetchers must not opt people
 * out by following the link).
 *
 * Routes → /api/v1/users/email-preferences/unsubscribe
 */
@Controller({ path: 'users/email-preferences', version: '1' })
export class EmailPreferencesController {
  constructor(private usersSvc: UsersService) {}

  @Get('unsubscribe')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Content-Type', 'text/html; charset=utf-8')
  confirmPage(@Query('token') token: string | undefined): string {
    const t = typeof token === 'string' && token.length <= 1024 ? token : '';
    const safe = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return page(
      'Unsubscribe from marketing emails',
      t
        ? `<p style="color:#c9c9d4;">You will stop receiving product news and offers. Verification, password reset and security emails are unaffected.</p>` +
          `<form method="post" action="unsubscribe"><input type="hidden" name="token" value="${safe}"/><button type="submit" style="background:#fff;border:0;border-radius:999px;padding:12px 28px;font-weight:bold;cursor:pointer;">Unsubscribe me</button></form>`
        : `<p style="color:#c9c9d4;">This unsubscribe link is missing or invalid.</p>`,
    );
  }

  @Post('unsubscribe')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribe(@Body() dto: UnsubscribeDto, @Req() req: Request): Promise<string> {
    const ctx = ctxOf(req);
    try {
      await this.usersSvc.unsubscribeMarketing(dto.token, { ip: ctx.ip, userAgent: ctx.device });
      return page('Unsubscribed', `<p style="color:#c9c9d4;">You will no longer receive marketing emails from Troxe. Verification, password reset and security emails are unaffected.</p>`);
    } catch {
      return page('Link invalid', `<p style="color:#c9c9d4;">This unsubscribe link is invalid or has expired. Nothing was changed.</p>`);
    }
  }
}
