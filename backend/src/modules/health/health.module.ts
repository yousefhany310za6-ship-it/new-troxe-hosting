import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ServersModule],
  controllers: [HealthController],
})
export class HealthModule {}
