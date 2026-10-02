import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NodePoolService } from './node-pool.service';
import { NodesService } from './nodes.service';

@Module({
  imports: [AuditModule],
  providers: [NodePoolService, NodesService],
  exports: [NodePoolService, NodesService],
})
export class NodesModule {}
