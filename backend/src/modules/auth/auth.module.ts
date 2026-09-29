import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { config } from '../../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';

@Module({
  imports: [JwtModule.register({ global: true, secret: config.JWT_ACCESS_SECRET }), AuditModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
