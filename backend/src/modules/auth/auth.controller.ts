import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser, ReqUser } from './current-user';
import { LoginDto, SignupDto } from './dto';
import { JwtAuthGuard } from './jwt.guard';

const REFRESH_COOKIE = 'troxe_refresh';
const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 3600 * 1000,
  path: '/',
};

// Routes → POST /api/v1/auth/signup ...
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('signup')
  async signup(@Body() dto: SignupDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const out = await this.auth.signup(dto, req);
    res.cookie(REFRESH_COOKIE, out.refresh, cookieOpts);
    return { user: out.user, accessToken: out.accessToken };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const out = await this.auth.login(dto, req);
    res.cookie(REFRESH_COOKIE, out.refresh, cookieOpts);
    return { user: out.user, accessToken: out.accessToken };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request) {
    return this.auth.refresh(req.cookies?.[REFRESH_COOKIE]);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  history(@CurrentUser() user: ReqUser) {
    return this.auth.history(user.sub);
  }
}
