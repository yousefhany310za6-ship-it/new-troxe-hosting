import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementAdminController } from './announcement-admin.controller';
import { AnnouncementsController } from './announcements.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AnnouncementAdminController, AnnouncementsController],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
