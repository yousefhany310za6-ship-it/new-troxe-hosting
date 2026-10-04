import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { UsersController } from './users.controller';
import { EmailPreferencesController } from './email-preferences.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, ServersModule],
  controllers: [UsersController, EmailPreferencesController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
