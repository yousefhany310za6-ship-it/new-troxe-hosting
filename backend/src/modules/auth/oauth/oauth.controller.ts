import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { config } from '../../../config/env';
import { AppError } from '../../../common/errors';
import { ctxOf } from '../../../common/request-context';
import { CurrentUser } from '../current-user';
import type { ReqUser } from '../jwt.guard';
import { JwtAuthGuard } from '../jwt.guard';
import { OAuthLinkConfirmDto, OAuthLinkStartDto } from './oauth.dto';
import { OAuthService } from './oauth.service';
import { isOAuthProvider, sanitizeNext, type OAuthProvider } from './oauth.helpers';

const COOKIE = config.REFRESH_COOKIE;
const cookieOpts = {
  httpOnly: true,
  secure: config.IS_PROD,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: config.JWT_REFRESH_TTL_SEC * 1000,
};

/** Single-use state cookie: scoped to the OAuth routes, 10-minute life. */
const STATE_COOKIE = 'oauth_state';
const stateCookieOpts = {
  httpOnly: true,
  secure: config.IS_PROD,
  sameSite: 'lax' as const,
  path: '/api/v1/auth/oauth',
  maxAge: 600 * 1000,
};
const clearStateOpts = { path: '/api/v1/auth/oauth', httpOnly: true, secure: config.IS_PROD, sameSite: 'lax' as const };

const startThrottle = { default: { limit: 30, ttl: 60_000 } };
const callbackThrottle = { default: { limit: 30, ttl: 60_000 } };

const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

/** Routes → /api/v1/auth/oauth/... (browser navigations, not fetch calls) */
@Controller({ path: 'auth/oauth', version: '1' })
export class OAuthController {
  constructor(private oauth: OAuthService) {}

  private frontend(status: string, params: Record<string, string>): string {
    const q = new URLSearchParams({ status, ...params }).toString();
    return `${config.OAUTH_FRONTEND_URL}/oauth/callback?${q}`;
  }

  /** Step 1 (login): mint state + PKCE, remember them in a signed cookie, 302 out. */
  @Get(':provider/start')
  @Throttle(startThrottle)
  start(
    @Param('provider') provider: string,
    @Query('next') next: string | undefined,
    @Res() res: Response,
  ): void {
    if (!isOAuthProvider(provider)) {
      res.redirect(this.frontend('error', { code: 'OAUTH_PROVIDER' }));
      return;
    }
    try {
      const { url, stateCookie } = this.oauth.start(provider, next, 'login');
      res.cookie(STATE_COOKIE, stateCookie, stateCookieOpts);
      noStore(res);
      res.redirect(url);
    } catch (e) {
      const code = e instanceof AppError ? ((e.getResponse() as { code?: string })?.code ?? 'OAUTH_FAILED') : 'OAUTH_FAILED';
      res.redirect(this.frontend('error', { code }));
    }
  }

  /** Step 1 (link): same, but the state binds the already-authenticated user. */
  @Post('link/start')
  @UseGuards(JwtAuthGuard)
  @Throttle(startThrottle)
  @HttpCode(200)
  linkStart(
    @CurrentUser() u: ReqUser,
    @Body() dto: OAuthLinkStartDto,
    @Res({ passthrough: true }) res: Response,
  ): { url: string } {
    const { url, stateCookie } = this.oauth.start(dto.provider, dto.next, 'link', u.sub);
    res.cookie(STATE_COOKIE, stateCookie, stateCookieOpts);
    return { url };
  }

  /** Step 2: provider redirects here with ?code&state — never trust the frontend. */
  @Get(':provider/callback')
  @Throttle(callbackThrottle)
  async callback(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    noStore(res);
    const clear = () => res.clearCookie(STATE_COOKIE, clearStateOpts);
    if (!isOAuthProvider(provider as OAuthProvider)) {
      clear();
      res.redirect(this.frontend('error', { code: 'OAUTH_PROVIDER' }));
      return;
    }
    try {
      const out = await this.oauth.callback(provider as OAuthProvider, (req.query ?? {}) as Record<string, unknown>, req.cookies?.[STATE_COOKIE], ctxOf(req));
      clear();
      if (out.kind === 'login') {
        res.cookie(COOKIE, out.issued.refreshToken, cookieOpts);
        res.redirect(this.frontend('ok', { next: sanitizeNext(out.next) }));
        return;
      }
      res.redirect(`${config.OAUTH_FRONTEND_URL}/settings?oauth_link=${encodeURIComponent(out.linkToken)}&provider=${out.kind === 'link_token' ? provider : ''}`);
    } catch (e) {
      clear();
      const code = e instanceof AppError ? ((e.getResponse() as { code?: string })?.code ?? 'OAUTH_FAILED') : 'OAUTH_FAILED';
      // suspended accounts get the dedicated screen, not a generic error
      if (code === 'ACCOUNT_SUSPENDED') {
        res.redirect(this.frontend('suspended', {}));
        return;
      }
      res.redirect(this.frontend('error', { code }));
    }
  }

  /** Step 3 (link): bind the verified provider account to the live session. */
  @Post('link/confirm')
  @UseGuards(JwtAuthGuard)
  @Throttle(startThrottle)
  @HttpCode(200)
  confirm(@CurrentUser() u: ReqUser, @Body() dto: OAuthLinkConfirmDto, @Req() req: Request) {
    return this.oauth.confirmLink(u.sub, dto.linkToken, ctxOf(req));
  }

  /** Linked providers for the Settings page. */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() u: ReqUser) {
    return this.oauth.status(u.sub);
  }

  /** Unlink — refuses to remove the last sign-in method. */
  @Delete(':provider')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  unlink(@CurrentUser() u: ReqUser, @Param('provider') provider: string, @Req() req: Request) {
    return this.oauth.unlink(u.sub, provider as OAuthProvider, ctxOf(req));
  }
}
