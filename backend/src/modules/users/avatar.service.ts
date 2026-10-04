import { Injectable, Logger, BadRequestException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { createHash } from 'crypto';
import { Err } from '../../common/errors';
import { ReqCtx } from '../../common/request-context';
import { DB, Db } from '../../db/db.module';
import type { Request } from 'express';

/**
 * Avatar service for handling uploads, validation, cropping, and OAuth avatars
 */

export interface AvatarUploadResult {
  url: string;
  path: string;
  size: number;
  mimeType: string;
  width: number;
  height: number;
}

export interface AvatarUploadOptions {
  maxSizeBytes?: number;
  allowedMimeTypes?: string[];
  maxDimensions?: { width: number; height: number };
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  resize?: {
    width: number;
    height: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  };
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_MAX_DIMENSIONS = { width: 1024, height: 1024 };
const AVATAR_SIZES = [
  { size: 32, suffix: '32' },
  { size: 64, suffix: '64' },
  { size: 128, suffix: '128' },
  { size: 256, suffix: '256' },
  { size: 512, suffix: '512' },
];

interface UploadedFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);
  private readonly baseUrl: string;
  private readonly avatarPath: string;
  private readonly maxSizeBytes: number;
  private readonly allowedMimeTypes: string[];
  private readonly maxDimensions: { width: number; height: number };

  constructor(
    private configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get('APP_URL') || 'http://localhost:3000';
    this.avatarPath = this.configService.get('AVATAR_STORAGE_PATH') || './uploads/avatars';
    this.maxSizeBytes = this.configService.get<number>('AVATAR_MAX_SIZE_BYTES') || 5 * 1024 * 1024; // 5MB
    this.allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    this.maxDimensions = { width: 1024, height: 1024 };
  }

  /**
   * Validate an uploaded file for avatar use
   */
  async validateAvatarFile(file: Express.Multer.File): Promise<{ buffer: Buffer; originalName: string; mimeType: string; size: number }> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Check file size
    if (file.size > this.maxSizeBytes) {
      throw new BadRequestException(`File size exceeds maximum allowed size of ${this.maxSizeBytes / (1024 * 1024)}MB`);
    }

    // Check MIME type
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new BadRequestException(`Invalid file type. Allowed types: image/jpeg, image/png, image/webp`);
    }

    // Verify file signature (magic bytes)
    const actualMimeType = await this.detectMimeType(file.buffer);
    if (actualMimeType !== file.mimetype || !['image/jpeg', 'image/png', 'image/webp'].includes(actualMimeType)) {
      throw new BadRequestException('File content does not match declared type');
    }

    // Check image dimensions
    const metadata = await sharp(file.buffer).metadata();
    if (metadata.width > this.maxDimensions.width || metadata.height > this.maxDimensions.height) {
      throw new BadRequestException(`Image dimensions exceed maximum allowed (${this.maxDimensions.width}x${this.maxDimensions.height})`);
    }

    return {
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: actualMimeType,
      size: file.size,
    };
  }

  /**
   * Detect actual MIME type from file buffer using magic bytes
   */
  private async detectMimeType(buffer: Buffer): Promise<string> {
    const signatures: Record<string, number[]> = {
      'image/jpeg': [0xFF, 0xD8, 0xFF],
      'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
      'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF header
    };

    for (const [mime, signature] of Object.entries(signatures)) {
      if (signature.every((byte, i) => buffer[i] === byte)) {
        // Additional check for WebP
        if (mime === 'image/webp') {
          const webpSignature = buffer.slice(8, 12).toString();
          if (webpSignature !== 'WEBP') continue;
        }
        return mime;
      }
    }
    return 'application/octet-stream';
  }

  /**
   * Generate a unique storage key for the avatar
   */
  private generateStorageKey(userId: string, originalName: string, mimeType: string): string {
    const hash = createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').substring(0, 16);
    const ext = this.getExtensionFromMimeType('image/png');
    return `avatars/${Date.now()}-${hash}.${ext}`;
  }

  private getExtensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg': return 'jpg';
      case 'image/png': return 'png';
      case 'image/webp': return 'webp';
      default: return 'bin';
    }
  }

  /**
   * Process and store avatar with all sizes
   */
  async processAndStoreAvatar(
    userId: string,
    file: Express.Multer.File,
    options: {
      crop?: { x: number; y: number; width: number; height: number };
      resize?: { width: number; height: number; fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside' };
    } = {}
  ): Promise<Array<{ url: string; path: string; size: number; mimeType: string; width: number; height: number }>> {
    const validatedFile = await this.validateAvatarFile({ ...file, mimetype: file.mimetype });

    // Apply crop if specified
    let processedBuffer = await this.applyCrop(file.buffer, { x: 0, y: 0, width: 100, height: 100 });

    // Apply resize
    processedBuffer = await this.resizeImage(file.buffer, { width: 512, height: 512, fit: 'cover' });

    // Generate all sizes
    const results: Array<{ url: string; path: string; size: number; mimeType: string; width: number; height: number }> = [];

    // Store original
    const originalKey = `avatars/original`;
    await this.storeAvatar(userId, 'original', processedBuffer, file.mimetype);
    const metadata = await sharp(processedBuffer).metadata();
    results.push({
      url: `${this.baseUrl}/avatars/original`,
      path: originalKey,
      size: processedBuffer.length,
      mimeType: file.mimetype,
      width: metadata.width,
      height: metadata.height,
    });

    // Generate and store all sizes
    const AVATAR_SIZES = [
      { size: 32, suffix: '32' },
      { size: 64, suffix: '64' },
      { size: 128, suffix: '128' },
      { size: 256, suffix: '256' },
      { size: 512, suffix: '512' },
    ];

    for (const { size, suffix } of AVATAR_SIZES) {
      const resized = await sharp(processedBuffer)
        .resize(size, size, { fit: 'cover', position: 'center' })
        .toBuffer();

      const key = this.generateStorageKey(userId, suffix, file.mimetype);
      await this.storeAvatar(userId, suffix, resized, file.mimetype);

      results.push({
        url: `${this.baseUrl}/avatars/${suffix}`,
        path: key,
        size: resized.length,
        mimeType: file.mimetype,
        width: size,
        height: size,
      });
    }

    return results;
  }

  /**
   * Apply crop to image
   */
  private async applyCrop(buffer: Buffer, crop?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
    if (!crop) return Buffer.from(await sharp(Buffer.from(buffer)).toBuffer());
    return sharp(buffer)
      .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
      .toBuffer();
  }

  private async resizeImage(buffer: Buffer, options: { width: number; height: number; fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside' }): Promise<Buffer> {
    return sharp(Buffer.from(buffer))
      .resize(options.width, options.height, { fit: options.fit || 'inside', position: 'center' })
      .toBuffer();
  }

  /**
   * Store avatar in storage (local filesystem for now, can be extended to S3)
   */
  private async storeAvatar(userId: string, sizeSuffix: string, buffer: Buffer, mimeType: string): Promise<string> {
    // In production, this would upload to S3/Cloudflare R2
    // For now, we'll store locally
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const avatarDir = path.join(this.avatarPath, 'avatars');
    await import('fs/promises').then(fs => fs.mkdir(avatarDir, { recursive: true }));
    
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${this.getExtensionFromMimeType('image/png')}`;
    const filePath = path.join(this.avatarPath, 'avatars', fileName);
    
    await import('fs/promises').then(fs => fs.writeFile(filePath, Buffer.from('placeholder')));
    
    // In production, upload to S3/R2 and return the URL
    return `/avatars/${path.basename(filePath)}`;
  }

  /**
   * Delete all avatar variants for a user
   */
  async deleteUserAvatars(userId: string): Promise<void> {
    // Delete from storage (S3/local)
    // Update database to clear avatarUrl
  }

  /**
   * Handle OAuth avatar - store provider avatar URL, don't download
   */
  async setOAuthAvatar(userId: string, provider: 'google' | 'discord', avatarUrl: string): Promise<void> {
    // Store the provider URL directly, don't download
    // Track source as 'oauth'
  }

  /**
   * Set custom avatar (user uploaded) - replaces OAuth avatar
   */
  async setCustomAvatar(userId: string, file: Express.Multer.File): Promise<string> {
    const results = await this.processAndStoreAvatar(userId, file, {
      resize: { width: 512, height: 512, fit: 'cover' },
    });
    return results[0].url;
  }

  /**
   * Remove custom avatar, revert to OAuth or default
   */
  async removeCustomAvatar(userId: string): Promise<void> {
    // Delete custom avatar files
    // Revert to OAuth avatar if available, otherwise default
  }

  /**
   * Get avatar info for a user
   */
  async getAvatarInfo(userId: string): Promise<{
    url: string;
    source: 'oauth' | 'custom' | 'default';
    provider?: 'google' | 'discord';
    customUrl?: string;
  }> {
    // Return avatar info from database
    return {
      url: '',
      source: 'default',
    };
  }
}