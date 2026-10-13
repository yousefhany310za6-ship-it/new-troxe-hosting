import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { TemplatesService } from './templates.service';

/**
 * Template administration, under the SAME admin guard as the rest of the
 * dashboard — a customer must never be able to read the verification matrix,
 * let alone influence a template's status.
 *
 * What is deliberately NOT here: an endpoint that marks a template `verified`.
 * That can only come from a real test run. If an admin could PATCH a badge on,
 * the badge would mean nothing and every consumer of it would be misled.
 */
@Controller({ path: 'admin/templates', version: '1' })
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminTemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  /** Catalog-wide health: schema errors, warnings and the status histogram. */
  @Get('health')
  health() {
    return this.svc.health();
  }

  /** Every template with its current status and last verification result. */
  @Get()
  list() {
    return this.svc.list();
  }

  /** One template with its full verification history. */
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  /**
   * Enable/disable a template for NEW servers.
   *
   * Existing servers on a disabled template keep running — that asymmetry is
   * deliberate and the response reports how many are affected, so the admin is
   * never guessing at the blast radius.
   */
  @Patch(':id/enabled')
  setEnabled(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    return this.svc.setEnabled(id, body?.enabled === true);
  }

  /** The image a template+version resolves to (incident response aid). */
  @Get(':id/versions/:version/image')
  image(@Param('id') id: string, @Param('version') version: string) {
    return { templateId: id, version, image: this.svc.resolveImage(id, version) };
  }

  /** Which template each legacy runtime row resolves to. */
  @Get('legacy/mapping')
  legacyMapping() {
    return this.svc.legacyMapping();
  }
}