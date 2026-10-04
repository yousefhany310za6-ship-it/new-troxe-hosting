import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ctxOf } from '../../common/request-context';
import { CurrentUser } from '../auth/current-user';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt.guard';
import type { ReqUser } from '../auth/jwt.guard';
import { EmailCampaignService } from './email-campaign.service';
import { CampaignCreateDto, CampaignUpdateDto, RecipientFiltersDto, RecipientsQueryDto, EmailSettingsDto } from './email-admin.dto';

const adminThrottle = { default: { limit: 60, ttl: 60_000 } };

/**
 * Admin-only email console. Every route below requires an admin session —
 * hiding buttons in the UI is presentation, this guard is the enforcement.
 *
 * Routes → /api/v1/admin/email/...
 */
@Controller({ path: 'admin/email', version: '1' })
@UseGuards(JwtAuthGuard, AdminGuard)
@Throttle(adminThrottle)
export class EmailAdminController {
  constructor(private campaigns: EmailCampaignService) {}

  /** Provider/sender status — secrets are NEVER included, not even for admins. */
  @Get('status')
  status() {
    return this.campaigns.status();
  }

  /** Toggle new-login security notifications (nothing else is affected). */
  @Patch('settings')
  settings(@CurrentUser() u: ReqUser, @Body() dto: EmailSettingsDto, @Req() req: Request) {
    return this.campaigns.setSettings(dto.newLoginEmails, ctxOf(req), u.sub);
  }

  @Post('campaigns')
  @HttpCode(201)
  create(@CurrentUser() u: ReqUser, @Body() dto: CampaignCreateDto, @Req() req: Request) {
    return this.campaigns.create(u.sub, dto, ctxOf(req));
  }

  @Get('campaigns')
  list() {
    return this.campaigns.list();
  }

  @Get('campaigns/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.detail(id);
  }

  @Patch('campaigns/:id')
  update(@CurrentUser() u: ReqUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CampaignUpdateDto, @Req() req: Request) {
    return this.campaigns.update(id, dto, ctxOf(req), u.sub);
  }

  /** How many users the current filters match — shown before sending. */
  @Post('campaigns/:id/recipients/preview')
  @HttpCode(200)
  preview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecipientFiltersDto) {
    void id;
    return this.campaigns.previewRecipients(dto);
  }

  /** Snapshot recipients + flip to sending. Returns immediately; delivery is async. */
  @Post('campaigns/:id/send')
  @HttpCode(202)
  send(@CurrentUser() u: ReqUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecipientFiltersDto, @Req() req: Request) {
    return this.campaigns.send(id, dto, ctxOf(req), u.sub);
  }

  @Post('campaigns/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: ReqUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.campaigns.cancel(id, ctxOf(req), u.sub);
  }

  @Get('campaigns/:id/recipients')
  recipients(@Param('id', ParseUUIDPipe) id: string, @Query() q: RecipientsQueryDto) {
    return this.campaigns.recipients(id, { status: q.status, limit: q.limit ?? 50, offset: q.offset ?? 0 });
  }
}
