import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { DockerService } from './docker.service';
import { ServerOwnerGuard } from './server-owner.guard';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';

@Module({
  controllers: [ServersController],
  providers: [ServersService, DockerService, JwtService, JwtAuthGuard, ServerOwnerGuard],
})
export class ServersModule {}
