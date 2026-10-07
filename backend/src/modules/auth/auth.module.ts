import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { config } from '../../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';
import { WsTicketService } from './ws-ticket.service';
import { AdminGrantService } from './admin-grant.service';
import { WsAuthGuard } from './ws-auth.guard';
import { AdminGuard } from './admin.guard';
import { RealtimeGateway } from './realtime.gateway';
import { OAuthController } from './oauth/oauth.controller';
import { OAuthService } from './oauth/oauth.service';
import { EmailAuthController } from './email-auth.controller';
import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [JwtModule.register({ global: true, secret: config.JWT_ACCESS_SECRET }), AuditModule, EmailModule],
  controllers: [AuthController, OAuthController, EmailAuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    WsTicketService,
    AdminGrantService,
    WsAuthGuard,
    AdminGuard,
    RealtimeGateway,
    OAuthService,
    EmailVerificationService,
    PasswordResetService,
  ],
  exports: [AuthService, JwtAuthGuard, WsTicketService, AdminGrantService, AdminGuard, RealtimeGateway, OAuthService],
})
export class AuthModule {}
