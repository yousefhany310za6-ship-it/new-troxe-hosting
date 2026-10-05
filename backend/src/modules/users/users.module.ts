import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { UsersController } from './users.controller';
import { EmailPreferencesController } from './email-preferences.controller';
import { AvatarController } from './avatar.controller';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';

@Module({
  imports: [AuthModule, ServersModule, ConfigModule],
  controllers: [UsersController, EmailPreferencesController, AvatarController],
  providers: [UsersService, AvatarService],
  exports: [UsersService, AvatarService],
})
export class UsersModule {}
