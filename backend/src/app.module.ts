import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { DbModule } from './db/db.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { NodesModule } from './modules/nodes/nodes.module';
import { PlansModule } from './modules/plans/plans.module';
import { ServersModule } from './modules/servers/servers.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    // global rate limiting (per-IP, in-memory) — auth routes tighten it further
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: config.RATE_LIMIT_WINDOW_MS, limit: config.RATE_LIMIT_MAX },
      ],
    }),
    DbModule,
    AuditModule,
    AuthModule,
    UsersModule,
    ServersModule,
    PlansModule,
    HealthModule,
    NodesModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
  ],
})
export class AppModule {}
