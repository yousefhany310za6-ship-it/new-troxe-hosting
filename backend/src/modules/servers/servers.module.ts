import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NodesModule } from '../nodes/nodes.module';
import { BackupsService } from './backups.service';
import { ExecGateway } from './exec.gateway';
import { FilesService } from './files.service';
import { DockerService } from './provisioning/docker.service';
import { NetworkHardeningService } from './provisioning/network-hardening.service';
import { ProvisionerService } from './provisioning/provisioner.service';
import { ReconcilerService } from './reconciler.service';
import { ServerOwnerGuard } from './server-owner.guard';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { StatsStreamService } from './stats-stream.service';

@Module({
  imports: [AuthModule, NodesModule],
  controllers: [ServersController],
  providers: [
    ServersService,
    BackupsService,
    FilesService,
    ExecGateway,
    ServerOwnerGuard,
    DockerService,
    NetworkHardeningService,
    ProvisionerService,
    ReconcilerService,
    StatsStreamService,
  ],
  exports: [ServersService, BackupsService, FilesService, DockerService, ProvisionerService, ReconcilerService, ExecGateway],
})
export class ServersModule {}
