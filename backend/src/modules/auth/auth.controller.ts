import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { config } from '../../config/env';
import { Err } from '../../common/errors';
import { ctxOf } from '../../common/request-context';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user';
import type { ReqUser } from './jwt.guard';
import { LoginDto, SignupDto } from './dto';
import { JwtAuthGuard } from './jwt.guard';
import { WsTicketService } from './ws-ticket.service';

const COOKIE = config.REFRESH_COOKIE;
const cookieOpts = {
  httpOnly: true,
  secure: config.IS_PROD,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: config.JWT_REFRESH_TTL_SEC * 1000,
};

const clearOpts = { path: '/', httpOnly: true, secure: config.IS_PROD, sameSite: 'lax' as const };

const authThrottle = {
  default: { limit: config.AUTH_RATE_LIMIT_MAX, ttl: config.RATE_LIMIT_WINDOW_MS },
};

const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

/** Routes → /api/v1/auth/... */
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private auth: AuthService,
    private wsTicket: WsTicketService,
  ) {}

  @Post('signup')
  @Throttle(authThrottle)
  @HttpCode(201)
  async signup(@Body() dto: SignupDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const out = await this.auth.signup(dto, ctxOf(req));
    res.cookie(COOKIE, out.refreshToken, cookieOpts);
    noStore(res);
    return { user: out.user, accessToken: out.accessToken, expiresAt: out.expiresAt, emailVerification: out.emailVerification };
  }

  @Post('login')
  @Throttle(authThrottle)
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const out = await this.auth.login(dto, ctxOf(req));
    res.cookie(COOKIE, out.refreshToken, cookieOpts);
    noStore(res);
    return { user: out.user, accessToken: out.accessToken, expiresAt: out.expiresAt };
  }

  /** Rotating refresh: cookie in → new cookie + fresh access token out. */
  @Post('refresh')
  @Throttle(authThrottle)
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    noStore(res);
    try {
      const out = await this.auth.refresh(req.cookies?.[COOKIE], ctxOf(req));
      res.cookie(COOKIE, out.refreshToken, cookieOpts);
      return { accessToken: out.accessToken, expiresAt: out.expiresAt };
    } catch (e) {
      res.clearCookie(COOKIE, clearOpts);
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE], ctxOf(req));
    res.clearCookie(COOKIE, clearOpts);
  }

  /** Kills every refresh session of the authenticated user. */
  @Post('logout-all')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async logoutAll(@CurrentUser() u: ReqUser, @Req() req: Request) {
    await this.auth.logoutAll(u.sub, ctxOf(req));
  }

  /** Login history (Overview page). */
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  history(@CurrentUser() u: ReqUser) {
    return this.auth.history(u.sub);
  }

  /** Currently valid refresh sessions (security page). */
  @Get('active-sessions')
  @UseGuards(JwtAuthGuard)
  activeSessions(@CurrentUser() u: ReqUser) {
    return this.auth.activeSessions(u.sub);
  }

  /** Kept for API-compat checks: proves the access token is alive. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() u: ReqUser) {
    if (!u?.sub) throw Err.unauthorized();
    return { id: u.sub, role: u.role };
  }

  /** Issue a short-lived WebSocket ticket (30s TTL). */
  @Post('ws/token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  wsToken(@CurrentUser() u: ReqUser) {
    return { ticket: this.wsTicket.issue(u.sub) };
  }
}
