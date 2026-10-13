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
import { RenewalService } from './renewal.service';
import { RenewalController, ExpiryRunnerService } from './renewal.controller';
import { WorkinkService } from './workink.service';
import { ServerOwnerGuard } from './server-owner.guard';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { StatsStreamService } from './stats-stream.service';
import { TemplatesService } from './templates/templates.service';
import { AdminTemplatesController } from './templates/admin-templates.controller';

@Module({
  imports: [AuthModule, NodesModule],
  controllers: [
    ServersController,
    PortsController,
    PackagesController,
    ServerCollabController,
    RenewalController,
    // the verification matrix + enable/disable, admin-guarded
    AdminTemplatesController,
  ],
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
    // free-plan expiry & renewal
    RenewalService,
    WorkinkService,
    ExpiryRunnerService,
    // template catalog administration
    TemplatesService,
  ],
  exports: [ServersService, PortsService, ServerAccessService, BackupsService, FilesService, DockerService, ProvisionerService, ReconcilerService, ExecGateway, TemplatesService],
})
export class ServersModule {}
