import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { NodesModule } from '../nodes/nodes.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuthModule, ServersModule, NodesModule, AuditModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}