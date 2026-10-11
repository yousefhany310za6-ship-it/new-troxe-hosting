import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NodesModule } from '../nodes/nodes.module';
import { BackupsService } from './backups.service';
import { ExecGateway } from './exec.gateway';
import { FilesService } from './files.service';
import { PortsService } from './ports.service';
import { PortsController } from './ports.controller';
import { ServerAccessService } from './server-access.service';
import { ServerAccessGuard } from './server-access.guard';
import { ServerUsersService } from './server-users.service';
import { ServerSchedulesService } from './server-schedules.service';
import { ScheduleRunnerService } from './schedule-runner.service';
import { ServerCollabController } from './server-collab.controller';
import { PackagesService } from './packages.service';
import { PackagesController } from './packages.controller';
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
  controllers: [ServersController, PortsController, PackagesController, ServerCollabController],
  providers: [
    ServersService,
    PortsService,
    PackagesService,
    ServerAccessService,
    ServerAccessGuard,
    ServerUsersService,
    ServerSchedulesService,
    ScheduleRunnerService,
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
  exports: [ServersService, PortsService, ServerAccessService, BackupsService, FilesService, DockerService, ProvisionerService, ReconcilerService, ExecGateway],
})
export class ServersModule {}
