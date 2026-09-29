import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({ controllers: [UsersController], providers: [UsersService, JwtService, JwtAuthGuard] })
export class UsersModule {}
