import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { DB, Db } from '../../db/db.module';
import { users } from '../../db/schema';
import { UpdateNotificationsDto, UpdatePasswordDto, UpdateProfileDto } from './dto';

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private db: Db) {}

  async me(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new UnauthorizedException('USER_GONE');
    const { passwordHash: _ph, ...safe } = u;
    return safe;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const [u] = await this.db
      .update(users)
      .set({ name: dto.name.trim(), email: dto.email.toLowerCase().trim() })
      .where(eq(users.id, userId))
      .returning();
    const { passwordHash: _ph, ...safe } = u;
    return safe;
  }

  async updatePassword(userId: string, dto: UpdatePasswordDto) {
    if (dto.next !== dto.confirm) throw new BadRequestException('PASSWORDS_MISMATCH');
    const [u] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u || !(await bcrypt.compare(dto.current, u.passwordHash)))
      throw new BadRequestException('WRONG_CURRENT_PASSWORD');
    await this.db.update(users).set({ passwordHash: await bcrypt.hash(dto.next, 10) }).where(eq(users.id, userId));
    return { ok: true };
  }

  async updateNotifications(userId: string, dto: UpdateNotificationsDto) {
    const patch: any = {};
    if (dto.restarts !== undefined) patch.notifyRestarts = dto.restarts;
    if (dto.invoices !== undefined) patch.notifyInvoices = dto.invoices;
    if (dto.marketing !== undefined) patch.notifyMarketing = dto.marketing;
    const [u] = await this.db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return { notifyRestarts: u.notifyRestarts, notifyInvoices: u.notifyInvoices, notifyMarketing: u.notifyMarketing };
  }
}
