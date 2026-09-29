import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DbModule } from './db/db.module';
import { AuthModule } from './modules/auth/auth.module';
import { ServersModule } from './modules/servers/servers.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    DbModule,
    JwtModule.register({ global: true, secret: process.env.JWT_ACCESS_SECRET ?? 'dev' }),
    AuthModule,
    UsersModule,
    ServersModule,
  ],
})
export class AppModule {}
