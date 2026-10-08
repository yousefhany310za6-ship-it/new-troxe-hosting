import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length, Matches } from 'class-validator';
import { JwtAuthGuard, type ReqUser } from './jwt.guard';
import { CurrentUser } from './current-user';
import { ctxOf } from '../../common/request-context';
import type { Request } from 'express';
import { TwoFactorService } from './two-factor.service';
import { AuthService } from './auth.service';
import { config } from '../../config/env';
import type { Response } from 'express';

const COOKIE = config.REFRESH_COOKIE;
const cookieOpts = {
  httpOnly: true,
  secure: config.IS_PROD,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: config.JWT_REFRESH_TTL_SEC * 1000,
};
const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

class TotpCodeDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code!: string;
}

class ChallengeCodeDto {
  @IsString()
  @Length(32, 64)
  challengeId!: string;

  @IsString()
  @Length(6, 12)
  code!: string;
}

@Controller({ path: 'auth/2fa', version: '1' })
export class TwoFactorController {
  constructor(
    private twoFactor: TwoFactorService,
    private auth: AuthService,
  ) {}

  /** 2FA status for the current user. */
  @Get()
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() u: ReqUser) {
    return this.twoFactor.getStatus(u.sub);
  }

  /** Step 1: start setup — generate secret, return otpauth URI + manual key. */
  @Post('setup')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @HttpCode(200)
  setup(@CurrentUser() u: ReqUser) {
    return this.twoFactor.startSetup(u.sub);
  }

  /** Step 2: confirm setup — verify TOTP, enable 2FA, return recovery codes. */
  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @HttpCode(200)
  confirm(@CurrentUser() u: ReqUser, @Body() dto: TotpCodeDto, @Req() req: Request) {
    return this.twoFactor.confirmSetup(u.sub, dto.code, ctxOf(req));
  }

  /** Disable 2FA — requires TOTP or recovery code. */
  @Post('disable')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @HttpCode(200)
  disable(@CurrentUser() u: ReqUser, @Body() dto: TotpCodeDto, @Req() req: Request) {
    return this.twoFactor.disable(u.sub, dto.code, ctxOf(req));
  }

  /** Regenerate recovery codes — requires TOTP or recovery code. */
  @Post('recovery-codes')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @HttpCode(200)
  regenerate(@CurrentUser() u: ReqUser, @Body() dto: TotpCodeDto, @Req() req: Request) {
    return this.twoFactor.regenerateRecoveryCodes(u.sub, dto.code, ctxOf(req));
  }

  /** Complete a login challenge with TOTP or recovery code. */
  @Post('verify')
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @HttpCode(200)
  async verify(@Body() dto: ChallengeCodeDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const c = ctxOf(req);
    const { userId } = await this.twoFactor.completeChallenge(dto.challengeId, dto.code, { ip: c.ip, userAgent: c.device });
    const out = await this.auth.finalizeMfaLogin(userId, c);
    res.cookie(COOKIE, out.refreshToken, cookieOpts);
    noStore(res);
    return { user: out.user, accessToken: out.accessToken, expiresAt: out.expiresAt };
  }
}
