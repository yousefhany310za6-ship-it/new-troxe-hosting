import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { createReadStream } from 'fs';
import type { Request, Response } from 'express';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user';
import { ctxOf } from '../../common/request-context';
import { config } from '../../config/env';
import { AvatarService, type CropRect } from './avatar.service';
import { CropRectDto } from './crop.dto';

@Controller({ path: 'users', version: '1' })
export class AvatarController {
  constructor(private avatarService: AvatarService) {}

  /** Upload a new avatar (multipart field `avatar`, JPEG/PNG/WebP ≤ 5MB). */
  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: config.AVATAR_MAX_SIZE_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
          return cb(new BadRequestException({ statusCode: 400, code: 'AVATAR_TYPE_INVALID', message: 'Only JPEG, PNG and WebP images are allowed' }), false);
        }
        cb(null, true);
      },
    }),
  )
  @HttpCode(200)
  uploadAvatar(@CurrentUser() u: ReqUser, @UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    const ctx = ctxOf(req);
    return this.avatarService.setCustomAvatar(u.sub, file, { ip: ctx.ip, userAgent: ctx.device });
  }

  /** Re-crop the stored original (pixels relative to the original image). */
  @Post('me/avatar/crop')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  cropAvatar(@CurrentUser() u: ReqUser, @Body() body: CropRectDto, @Req() req: Request) {
    const ctx = ctxOf(req);
    return this.avatarService.cropAvatar(u.sub, body, { ip: ctx.ip, userAgent: ctx.device });
  }

  @Get('me/avatar')
  @UseGuards(JwtAuthGuard)
  getAvatar(@CurrentUser() u: ReqUser) {
    return this.avatarService.getAvatarInfo(u.sub);
  }

  /** Remove the custom avatar (falls back to OAuth snapshot / default). */
  @Delete('me/avatar')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  removeAvatar(@CurrentUser() u: ReqUser, @Req() req: Request) {
    const ctx = ctxOf(req);
    return this.avatarService.removeCustomAvatar(u.sub, { ip: ctx.ip, userAgent: ctx.device });
  }

  /**
   * Public avatar serving. Keys are unguessable random ids; the URL carries
   * no session, so browsers can <img> it without headers. Long cache +
   * immutable: a new upload always gets a new key.
   */
  @Get('avatars/:filename')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async serveAvatar(@Param('filename') filename: string, @Res() res: Response) {
    const hit = await this.avatarService.resolveFile(filename);
    if (!hit) throw new NotFoundException('AVATAR_NOT_FOUND');
    res.set({
      'Content-Type': hit.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    });
    createReadStream(hit.path).pipe(res);
  }
}
