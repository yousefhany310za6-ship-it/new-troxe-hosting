import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { config } from '../../config/env';
import { Err } from '../../common/errors';
import { DB, Db } from '../../db/db.module';
import { oauthAccounts, users } from '../../db/schema';
import { AuditService } from '../audit/audit.module';

/** Declared-MIME → magic-byte signature. The declared type is never trusted. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  'image/webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

const ALLOWED_MIME = new Set(Object.keys(SIGNATURES));
const ORIGINAL_MAX_PX = 1024; // stored original is normalized to fit inside
const AVATAR_PX = 256; // served avatar
const MAX_DIMENSION = 8192; // absurd-pixel bomb guard
const KEY_RE = /^[A-Za-z0-9_-]{16,128}\.webp$/;

export interface CropRect {
  x: number;
  y: number;
  size: number;
}

@Injectable()
export class AvatarService {
  private readonly log = new Logger(AvatarService.name);
  private readonly dir = path.resolve(config.AVATAR_STORAGE_PATH);

  constructor(
    @Inject(DB) private db: Db,
    private audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- storage

  private async ensureDir() {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o750 });
  }

  /** Public URL path stored in users.avatar_url — served by AvatarController. */
  private urlFor(key: string) {
    return `/api/v1/users/avatars/${key}.webp`;
  }

  private origPath(key: string, ext: string) {
    return path.join(this.dir, `${key}_orig.${ext}`);
  }

  private avatarPath(key: string) {
    return path.join(this.dir, `${key}.webp`);
  }

  /** Extract the storage key from one of our avatar URLs (null if foreign). */
  private keyFromUrl(url: string | null): string | null {
    if (!url) return null;
    const m = /^\/api\/v1\/users\/avatars\/([A-Za-z0-9_-]{16,128})\.webp$/.exec(url);
    return m ? m[1] : null;
  }

  private async unlinkQuiet(p: string) {
    await fs.unlink(p).catch(() => undefined);
  }

  private async deleteFiles(key: string | null) {
    if (!key) return;
    await this.unlinkQuiet(this.avatarPath(key));
    // original extension is unknown — try the three we accept
    for (const ext of ['jpg', 'png', 'webp']) await this.unlinkQuiet(this.origPath(key, ext));
  }

  // ------------------------------------------------------------ validation

  /**
   * Validate the uploaded buffer beyond its declared type:
   *  - size cap (multer enforces too, belt-and-suspenders)
   *  - declared MIME allowlist
   *  - magic-byte signature must match the declared type
   *  - sharp must actually parse it as an image (polyglot guard)
   *  - sane pixel dimensions (decompression-bomb guard)
   */
  private async validate(file: Express.Multer.File): Promise<Sharp> {
    if (!file?.buffer?.length) throw Err.invalid('AVATAR_EMPTY', 'No file uploaded');
    if (file.size > config.AVATAR_MAX_SIZE_BYTES) {
      throw Err.invalid('AVATAR_TOO_LARGE', `Avatar must be ≤ ${Math.floor(config.AVATAR_MAX_SIZE_BYTES / 1048576)} MB`);
    }
    const sniff = SIGNATURES[file.mimetype];
    if (!sniff || !ALLOWED_MIME.has(file.mimetype) || !sniff(file.buffer)) {
      throw Err.invalid('AVATAR_TYPE_INVALID', 'Only JPEG, PNG and WebP images are allowed');
    }
    let img: Sharp;
    let meta: Metadata;
    try {
      img = sharp(file.buffer, { failOn: 'error' });
      meta = await img.metadata();
    } catch {
      throw Err.invalid('AVATAR_CORRUPT', 'The file is not a valid image');
    }
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h || w > MAX_DIMENSION || h > MAX_DIMENSION) {
      throw Err.invalid('AVATAR_DIMENSIONS_INVALID', 'Image dimensions are invalid');
    }
    return img;
  }

  // ------------------------------------------------------------------ API

  /**
   * Upload → validate → store normalized original + 256px webp derivative →
   * persist users.avatar_url/avatar_source. Returns the new avatar URL.
   */
  async setCustomAvatar(userId: string, file: Express.Multer.File, ctx: { ip: string; userAgent?: string }) {
    const img = await this.validate(file);
    await this.ensureDir();

    const key = randomBytes(24).toString('base64url');
    const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';

    // normalized original: re-encoded (strips metadata/polyglot tails), ≤1024px
    await img
      .clone()
      .rotate() // respect EXIF orientation
      .resize(ORIGINAL_MAX_PX, ORIGINAL_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .toFormat(ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg', { quality: 92 })
      .toFile(this.origPath(key, ext));

    // default derivative: centered square 256×256 webp
    await sharp(this.origPath(key, ext))
      .resize(AVATAR_PX, AVATAR_PX, { fit: 'cover', position: 'centre' })
      .webp({ quality: 88 })
      .toFile(this.avatarPath(key));

    const [existing] = await this.db
      .select({ email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!existing) {
      await this.deleteFiles(key);
      throw Err.unauthorized('USER_GONE');
    }

    const oldKey = this.keyFromUrl(existing.avatarUrl);
    const avatarUrl = this.urlFor(key);
    const [updated] = await this.db
      .update(users)
      .set({ avatarUrl, avatarSource: 'custom' })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) {
      await this.deleteFiles(key);
      throw Err.unauthorized('USER_GONE');
    }

    // only after the DB points at the new files
    await this.deleteFiles(oldKey);

    await this.audit.record({
      actorId: userId,
      actorEmail: existing.email,
      action: 'user.avatar.custom_set',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    this.log.log(`avatar set for ${userId} → ${key}`);
    return { avatarUrl, avatarSource: 'custom' as const };
  }

  /**
   * Re-derive the 256px avatar from the stored original using a crop rect
   * (pixels relative to the stored, orientation-normalized original).
   */
  async cropAvatar(userId: string, rect: CropRect, ctx: { ip: string; userAgent?: string }) {
    const [user] = await this.db
      .select({ avatarUrl: users.avatarUrl, avatarSource: users.avatarSource })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || user.avatarSource !== 'custom') throw Err.invalid('NO_CUSTOM_AVATAR', 'Upload an avatar first');
    const key = this.keyFromUrl(user.avatarUrl);
    if (!key) throw Err.invalid('NO_CUSTOM_AVATAR', 'Upload an avatar first');

    let orig: string | null = null;
    for (const ext of ['jpg', 'png', 'webp']) {
      const p = this.origPath(key, ext);
      if (await fs.stat(p).then(() => true, () => false)) { orig = p; break; }
    }
    if (!orig) throw Err.notFound('AVATAR_ORIGINAL_GONE');

    const meta = await sharp(orig).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    const size = Math.round(rect.size);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size) || size < 1 || x < 0 || y < 0 || x + size > W || y + size > H) {
      throw Err.invalid('CROP_INVALID', `Crop must fit inside ${W}×${H}`);
    }

    await sharp(orig)
      .extract({ left: x, top: y, width: size, height: size })
      .resize(AVATAR_PX, AVATAR_PX, { fit: 'cover' })
      .webp({ quality: 88 })
      .toFile(this.avatarPath(key) + '.tmp');
    await fs.rename(this.avatarPath(key) + '.tmp', this.avatarPath(key));

    await this.audit.record({
      actorId: userId,
      action: 'user.avatar.cropped',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { avatarUrl: this.urlFor(key), avatarSource: 'custom' as const };
  }

  /**
   * Remove the custom avatar. Falls back to the latest OAuth avatar snapshot
   * when one exists, otherwise to the generated default (NULL url).
   */
  async removeCustomAvatar(userId: string, ctx: { ip: string; userAgent?: string }) {
    const [existing] = await this.db
      .select({ email: users.email, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!existing) throw Err.unauthorized('USER_GONE');

    const [oauth] = await this.db
      .select({ avatarUrl: oauthAccounts.avatarUrl })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId))
      .limit(1);

    const fallbackUrl = oauth?.avatarUrl ?? null;
    const fallbackSource: 'oauth' | 'default' = oauth?.avatarUrl ? 'oauth' : 'default';
    const oldKey = this.keyFromUrl(existing.avatarUrl);

    const [updated] = await this.db
      .update(users)
      .set({ avatarUrl: fallbackUrl, avatarSource: fallbackSource })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) throw Err.unauthorized('USER_GONE');

    await this.deleteFiles(oldKey);
    await this.audit.record({
      actorId: userId,
      actorEmail: existing.email,
      action: 'user.avatar.removed',
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { avatarUrl: fallbackUrl, avatarSource: fallbackSource };
  }

  async getAvatarInfo(userId: string) {
    const [user] = await this.db
      .select({ avatarUrl: users.avatarUrl, avatarSource: users.avatarSource })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw Err.unauthorized('USER_GONE');
    return user;
  }

  /**
   * Resolve a public avatar key to a file path for streaming.
   * Keys are unguessable random ids; the filename pattern is strictly
   * validated so the lookup can never escape the storage directory.
   */
  async resolveFile(filename: string): Promise<{ path: string; contentType: string } | null> {
    if (!KEY_RE.test(filename)) return null;
    const p = this.avatarPath(filename.slice(0, -5)); // strip .webp
    if (path.dirname(p) !== this.dir) return null;
    const ok = await fs.stat(p).then((s) => s.isFile(), () => false);
    return ok ? { path: p, contentType: 'image/webp' } : null;
  }
}
