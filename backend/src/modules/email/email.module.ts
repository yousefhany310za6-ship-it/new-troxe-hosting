import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmailService } from './email.service';
import { EmailSettingsService } from './email-settings.service';
import { LoginNotifyService } from './login-notify.service';
import { EmailWebhookController } from './email-webhook.controller';

/**
 * Outgoing mail. EmailService is the only gateway to Resend; the settings
 * service backs admin-toggled flags; the notify service powers new-IP
 * security alerts. Auth/admin modules import this — it imports nothing from
 * them (no cycles).
 */
@Module({
  imports: [AuditModule],
  controllers: [EmailWebhookController],
  providers: [EmailService, EmailSettingsService, LoginNotifyService],
  exports: [EmailService, EmailSettingsService, LoginNotifyService],
})
export class EmailModule {}
