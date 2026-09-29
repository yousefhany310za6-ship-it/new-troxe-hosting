import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtService, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
