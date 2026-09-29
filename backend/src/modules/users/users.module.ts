import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, ServersModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
