import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ctxOf } from '../../common/request-context';
import { CurrentUser } from './current-user';
import type { ReqUser } from './jwt.guard';
import { JwtAuthGuard } from './jwt.guard';
import { PasswordResetConfirmDto, PasswordResetRequestDto, VerifyCodeDto } from './email-auth.dto';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';

/** Routes → /api/v1/auth/email-verification/... and /api/v1/auth/password-reset/... */
@Controller({ path: 'auth', version: '1' })
export class EmailAuthController {
  constructor(
    private verification: EmailVerificationService,
    private reset: PasswordResetService,
  ) {}

  /** (Re)send the 6-digit code — invalidates the previous one, 60s cooldown. */
  @Post('email-verification/send')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @HttpCode(200)
  send(@CurrentUser() u: ReqUser, @Req() req: Request) {
    return this.verification.send(u.sub, ctxOf(req));
  }

  /** Consume a code: single-use, 10-minute life, 5 wrong guesses kill it. */
  @Post('email-verification/verify')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @HttpCode(200)
  verify(@CurrentUser() u: ReqUser, @Body() dto: VerifyCodeDto, @Req() req: Request) {
    return this.verification.verify(u.sub, dto.code, ctxOf(req));
  }

  /**
   * Always `{ok:true}` — existing, missing, or malformed address. Anything
   * else would let an attacker enumerate registered emails.
   */
  @Post('password-reset/request')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @HttpCode(200)
  requestReset(@Body() dto: PasswordResetRequestDto, @Req() req: Request) {
    return this.reset.request(dto.email, ctxOf(req));
  }

  /** Single-use link → new password. Generic error in every failure case. */
  @Post('password-reset/confirm')
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @HttpCode(200)
  confirmReset(@Body() dto: PasswordResetConfirmDto, @Req() req: Request) {
    return this.reset.confirm(dto.token, dto.next, dto.confirm, ctxOf(req));
  }
}
