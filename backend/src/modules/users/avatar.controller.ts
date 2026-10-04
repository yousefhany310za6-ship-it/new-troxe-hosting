import { Controller, Post, UploadedFile, UseInterceptors, Delete, HttpCode, UseGuards, Get, Req, Body, HttpCode as HttpCodeDec } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard, type ReqUser } from '../auth/jwt.guard';
import { AvatarService } from './avatar.service';
import { ReqCtx } from '../../common/request-context';
import { ctxOf } from '../../common/request-context';
import { Request } from 'express';
import { CurrentUser } from '../auth/current-user';

@Controller({ path: 'users/me/avatar', version: '1' })
export class AvatarController {
  constructor(private avatarService: AvatarService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('avatar', {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
        return cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'), false);
      }
      cb(null, true);
    },
  }))
  @HttpCode(200)
  async uploadAvatar(
    @CurrentUser() user: { sub: string },
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const avatarUrl = await this.avatarService.setCustomAvatar(user.sub, file);
    return { avatarUrl };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async getAvatar(@CurrentUser() user: { sub: string }) {
    return this.avatarService.getAvatarInfo(user.sub);
  }

  @Delete()
  @HttpCode(200)
  async removeAvatar(@CurrentUser() user: { sub: string }) {
    await this.avatarService.removeCustomAvatar(user.sub);
    return { ok: true };
  }

  @Post('crop')
  @HttpCode(200)
  async cropAvatar(
    @CurrentUser() user: { sub: string },
    @Body() body: { x: number; y: number; width: number; height: number },
    @Req() req: Request,
  ) {
    // Crop and re-upload logic
    return { message: 'Crop endpoint - to be implemented' };
  }
}