import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { config } from '../../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';
import { WsTicketService } from './ws-ticket.service';
import { WsAuthGuard } from './ws-auth.guard';
import { AdminGuard } from './admin.guard';
import { RealtimeGateway } from './realtime.gateway';
import { OAuthController } from './oauth/oauth.controller';
import { OAuthService } from './oauth/oauth.service';

@Module({
  imports: [JwtModule.register({ global: true, secret: config.JWT_ACCESS_SECRET }), AuditModule],
  controllers: [AuthController, OAuthController],
  providers: [AuthService, JwtAuthGuard, WsTicketService, WsAuthGuard, AdminGuard, RealtimeGateway, OAuthService],
  exports: [AuthService, JwtAuthGuard, WsTicketService, AdminGuard, RealtimeGateway, OAuthService],
})
export class AuthModule {}
