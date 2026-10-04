import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { EmailAdminController } from './email-admin.controller';
import { EmailCampaignService } from './email-campaign.service';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { NodesModule } from '../nodes/nodes.module';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [AuthModule, ServersModule, NodesModule, AuditModule, EmailModule],
  controllers: [AdminController, EmailAdminController],
  providers: [AdminService, EmailCampaignService],
  exports: [AdminService],
})
export class AdminModule {}