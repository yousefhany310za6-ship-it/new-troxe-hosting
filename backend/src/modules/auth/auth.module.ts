import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { config } from '../../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';
import { WsTicketService } from './ws-ticket.service';
import { WsAuthGuard } from './ws-auth.guard';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [JwtModule.register({ global: true, secret: config.JWT_ACCESS_SECRET }), AuditModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, WsTicketService, WsAuthGuard, RealtimeGateway],
  exports: [AuthService, JwtAuthGuard, WsTicketService, RealtimeGateway],
})
export class AuthModule {}
