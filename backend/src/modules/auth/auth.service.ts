import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { and, desc, eq } from 'drizzle-orm';
import { DB, Db } from '../../db/db.module';
import { sessions, users } from '../../db/schema';
import { LoginDto, SignupDto } from './dto';

const ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? '15m';

function ctxOf(req: any) {
  const ip = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0] ?? req.ip ?? 'unknown';
  const device: string = req.headers?.['user-agent']?.slice(0, 255) ?? 'unknown';
  return { ip: String(ip).slice(0, 45), device };
}

@Injectable()
export class AuthService {
  constructor(@Inject(DB) private db: Db, private jwt: JwtService) {}

  private accessToken(u: { id: string; email: string; role: string }) {
    return this.jwt.sign(
      { sub: u.id, email: u.email, role: u.role },
      { secret: process.env.JWT_ACCESS_SECRET ?? 'dev', expiresIn: ACCESS_TTL },
    );
  }

  private refreshToken(userId: string) {
    return this.jwt.sign(
      { sub: userId, type: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh', expiresIn: '7d' },
    );
  }

  async signup(dto: SignupDto, req: any) {
    const email = dto.email.toLowerCase().trim();
    const exists = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (exists.length) throw new ConflictException('EMAIL_TAKEN');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const [user] = await this.db
      .insert(users)
      .values({ name: dto.name.trim(), email, passwordHash })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role });

    const refresh = this.refreshToken(user.id);
    const { ip, device } = ctxOf(req);
    await this.db.insert(sessions).values({
      userId: user.id,
      refreshHash: await bcrypt.hash(refresh, 10),
      ip,
      device,
      location: 'Unknown',
      status: 'success',
    } as any);
    return { user, accessToken: this.accessToken(user), refresh };
  }

  async login(dto: LoginDto, req: any) {
    const email = dto.email.toLowerCase().trim();
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    const { ip, device } = ctxOf(req);

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      if (user) {
        await this.db.insert(sessions).values({ userId: user.id, ip, device, status: 'failed' } as any);
      }
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    const refresh = this.refreshToken(user.id);
    await this.db.insert(sessions).values({
      userId: user.id,
      refreshHash: await bcrypt.hash(refresh, 10),
      ip,
      device,
      status: 'success',
    } as any);
    const safe = { id: user.id, name: user.name, email: user.email, role: user.role };
    return { user: safe, accessToken: this.accessToken(safe), refresh };
  }

  async refresh(refresh: string | undefined) {
    if (!refresh) throw new UnauthorizedException('NO_REFRESH');
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(refresh, {
        secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh',
      });
    } catch {
      throw new UnauthorizedException('INVALID_REFRESH');
    }
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, payload.sub)))
      .orderBy(desc(sessions.createdAt))
      .limit(20);
    for (const s of rows) {
      if (s.refreshHash && (await bcrypt.compare(refresh, s.refreshHash))) {
        const [u] = await this.db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
        if (!u) throw new UnauthorizedException('USER_GONE');
        return { accessToken: this.accessToken({ id: u.id, email: u.email, role: u.role }) };
      }
    }
    throw new UnauthorizedException('REFRESH_REUSED');
  }

  async logout(refresh: string | undefined) {
    if (!refresh) return;
    const all = await this.db.select().from(sessions);
    for (const s of all.slice(-200)) {
      if (s.refreshHash && (await bcrypt.compare(refresh, s.refreshHash))) {
        await this.db.delete(sessions).where(eq(sessions.id, s.id));
        break;
      }
    }
  }

  async history(userId: string) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(20);
    const [current, ...rest] = rows;
    const fmt = (s: (typeof rows)[number]) => ({
      id: s.id,
      status: s.status,
      ip: s.ip,
      location: s.location ?? 'Unknown',
      countryCode: s.countryCode ?? 'xx',
      device: s.device,
      createdAt: s.createdAt,
    });
    return { current: current ? fmt(current) : null, history: rows.map(fmt) };
  }
}
