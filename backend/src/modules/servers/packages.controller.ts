import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { ServerAccessGuard } from './server-access.guard';
import { CurrentUser } from '../auth/current-user';
import { ctxOf } from '../../common/request-context';
import { PackagesService } from './packages.service';
import { MANAGER_LABEL } from './package-policy';

const UUID = new ParseUUIDPipe({ version: '4' });

/** The only client-controlled field: a package name. Everything else is derived. */
export class PackageNameDto {
  @IsString()
  @MaxLength(214)
  name!: string;
}

/**
 * Package management for a server. All routes are owner-scoped (the service
 * re-checks ownership and a running container), rate-limited, and audited.
 * There is deliberately no endpoint that runs an arbitrary command.
 */
@Controller({ path: 'servers', version: '1' })
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PackagesController {
  constructor(private packages: PackagesService) {}

  /** Installed packages (from the server's real manifests) + its manager. */
  @Get(':id/packages')
  @UseGuards(ServerAccessGuard)
  list(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    return this.packages.list(id, u.sub);
  }

  /** Which package manager this server's runtime uses (so the UI can show it). */
  @Get(':id/packages/manager')
  @UseGuards(ServerAccessGuard)
  async manager(@Param('id', UUID) id: string, @CurrentUser() u: ReqUser) {
    const info = await this.packages.list(id, u.sub);
    return { manager: info.manager, label: info.manager ? MANAGER_LABEL[info.manager] : null };
  }

  @Post(':id/packages/install')
  @UseGuards(ServerAccessGuard)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  install(@Param('id', UUID) id: string, @Body() dto: PackageNameDto, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    return this.packages.install(id, u.sub, dto.name, ctxOf(req).ip);
  }

  @Post(':id/packages/uninstall')
  @UseGuards(ServerAccessGuard)
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  uninstall(@Param('id', UUID) id: string, @Body() dto: PackageNameDto, @CurrentUser() u: ReqUser, @Req() req: { ip?: string; headers: Record<string, unknown> }) {
    return this.packages.uninstall(id, u.sub, dto.name, ctxOf(req).ip);
  }
}
