import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { WsAuthGuard } from '../auth/ws-auth.guard';
import { WsTicketService } from '../auth/ws-ticket.service';
import { SupportService } from './support.service';
import { SupportGateway } from './support.gateway';
import { TicketsController } from './tickets.controller';
import { QueueController } from './queue.controller';
import { AdminSupportController } from './admin-support.controller';
import { SupportGuard } from './support.guard';

/**
 * Support tickets + real-time chat.
 *
 * Wiring notes:
 * - The gateway injects the service (one direction). The service publishes
 *   through the `SupportEvents` interface, which the gateway registers on
 *   module init — so no circular provider dependency exists.
 * - Read-only access to server telemetry/logs comes from ServersModule's
 *   DockerService/ProvisionerService. No power actions are exposed here, so
 *   the support path can never start/stop/delete a user's server.
 * - DbModule/AuditModule are @Global(); WsAuthGuard + WsTicketService are
 *   (re)provided locally so this module never imports AuthModule (which owns
 *   the main /ws gateway) and cannot create a provider cycle.
 */
@Module({
  imports: [ServersModule],
  controllers: [TicketsController, QueueController, AdminSupportController],
  providers: [SupportService, SupportGateway, SupportGuard, WsAuthGuard, WsTicketService],
  // SupportGateway is exported so admin actions (role change / suspension /
  // deletion) can drop a user's live support sockets immediately.
  exports: [SupportService, SupportGateway],
})
export class SupportModule {}
