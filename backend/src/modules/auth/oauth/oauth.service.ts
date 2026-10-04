import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { config } from '../../../config/env';
import { Err } from '../../../common/errors';
import { ReqCtx } from '../../../common/request-context';
import { DB, Db } from '../../../db/db.module';
import { oauthAccounts, users } from '../../../db/schema';
import { AuditService } from '../../audit/audit.module';
import { AuthService } from '../auth.service';
import {
  DISCORD_AUTH_URL,
  DISCORD_SCOPES,
  GOOGLE_AUTH_URL,
  GOOGLE_SCOPES,
  OAUTH_LINK_TOKEN_TTL_SEC,
  OAUTH_STATE_TTL_SEC,
  isOAuthProvider,
  newCodeVerifier,
  newStateValue,
  pkceChallenge,
  sanitizeNext,
  signLinkToken,
  signState,
  verifyLinkToken,
  verifyState,
  type OAuthProvider,
} from './oauth.helpers';
import { discordProfile, googleProfile, type FetchImpl, type ProviderProfile } from './oauth.providers';
import { ensureGuildMember } from './discord-guild.service';

/** Bounded query-param string (callback `code`/`state` are attacker-influenced). */
function qstr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

@Injectable()
export class OAuthService {
  private readonly log = new Logger(OAuthService.name);

  constructor(
    @Inject(DB) private db: Db,
    private auth: AuthService,
    private audit: AuditService,
  ) {}

  private get enabled(): Record<OAuthProvider, boolean> {
    return { google: config.GOOGLE_ENABLED, discord: config.DISCORD_ENABLED };
  }

  private requireEnabled(provider: OAuthProvider): void {
    if (!this.enabled[provider]) throw Err.forbidden('OAUTH_DISABLED');
  }

  private callbackUrl(provider: OAuthProvider): string {
    return `${config.OAUTH_REDIRECT_BASE_URL}/api/v1/auth/oauth/${provider}/callback`;
  }

  // ---- start ---------------------------------------------------------------

  start(provider: OAuthProvider, next: unknown, mode: 'login' | 'link', uid?: string): { url: string; stateCookie: string } {
    this.requireEnabled(provider);
    if (mode === 'link' && !uid) throw Err.unauthorized('OAUTH_LINK_NO_USER');
    const verifier = newCodeVerifier();
    const state: Omit<Parameters<typeof signState>[0], 'v'> = {
      s: newStateValue(),
      p: provider,
      m: mode,
      n: sanitizeNext(next),
      cv: verifier,
      ...(mode === 'link' ? { u: uid as string } : {}),
      exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SEC,
    };
    const cookie = signState(state, config.JWT_ACCESS_SECRET);
    const challenge = pkceChallenge(verifier);
    const redirectUri = this.callbackUrl(provider);
    const url =
      provider === 'google'
        ? `${GOOGLE_AUTH_URL}?${new URLSearchParams({
            client_id: config.GOOGLE_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: GOOGLE_SCOPES,
            state: state.s,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            access_type: 'online',
            prompt: 'select_account',
          }).toString()}`
        : `${DISCORD_AUTH_URL}?${new URLSearchParams({
            client_id: config.DISCORD_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: DISCORD_SCOPES,
            state: state.s,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            prompt: 'consent',
          }).toString()}`;
    return { url, stateCookie: cookie };
  }

  // ---- provider exchanges (server-side only) ----------------------------------

  /** Exchange the code and return the verified profile + the raw user access token. */
  async fetchProfile(
    provider: OAuthProvider,
    code: string,
    verifier: string,
    fetchImpl: FetchImpl = fetch,
  ): Promise<{ profile: ProviderProfile; userAccessToken: string }> {
    const cfg = {
      clientId: provider === 'google' ? config.GOOGLE_CLIENT_ID : config.DISCORD_CLIENT_ID,
      clientSecret: provider === 'google' ? config.GOOGLE_CLIENT_SECRET : config.DISCORD_CLIENT_SECRET,
      redirectUri: this.callbackUrl(provider),
    };
    return provider === 'google'
      ? googleProfile(code, verifier, cfg, fetchImpl)
      : discordProfile(code, verifier, cfg, fetchImpl);
  }

  // ---- callback ---------------------------------------------------------------

  async callback(
    provider: OAuthProvider,
    query: Record<string, unknown>,
    stateCookie: string | undefined,
    ctx: ReqCtx,
    fetchImpl: FetchImpl = fetch,
  ): Promise<
    | { kind: 'login'; issued: { refreshToken: string }; next: string }
    | { kind: 'link_token'; linkToken: string; next: string }
  > {
    this.requireEnabled(provider);
    if (typeof query.error === 'string' && query.error) {
      await this.audit.record({
        actorEmail: undefined,
        action: `auth.oauth.${provider}.denied`,
        ip: ctx.ip,
        userAgent: ctx.device,
        meta: { error: String(query.error).slice(0, 120) },
      });
      throw Err.invalid('OAUTH_DENIED', 'Authorization was denied');
    }
    const code = qstr(query.code, 4096);
    const stateParam = qstr(query.state, 512);
    if (!code || !stateParam || !stateCookie) throw Err.invalid('OAUTH_STATE', 'Invalid OAuth response');
    const st = verifyState(stateCookie, config.JWT_ACCESS_SECRET, provider);
    if (!st || st.s !== stateParam) {
      await this.audit.record({
        actorEmail: undefined,
        action: `auth.oauth.${provider}.bad_state`,
        ip: ctx.ip,
        userAgent: ctx.device,
      });
      throw Err.invalid('OAUTH_STATE', 'Invalid OAuth response');
    }

    const { profile, userAccessToken } = await this.fetchProfile(provider, code, st.cv, fetchImpl);

    if (st.m === 'link') {
      const linkToken = signLinkToken(
        {
          uid: st.u as string,
          p: provider,
          puid: profile.providerUserId,
          em: profile.email,
          ev: profile.emailVerified,
          av: profile.avatarUrl,
          exp: Math.floor(Date.now() / 1000) + OAUTH_LINK_TOKEN_TTL_SEC,
        },
        config.JWT_ACCESS_SECRET,
      );
      await this.db
        .update(oauthAccounts)
        .set({ email: profile.email, emailVerified: profile.emailVerified, avatarUrl: profile.avatarUrl })
        .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, profile.providerUserId)))
        .catch(() => undefined);
      return { kind: 'link_token', linkToken, next: st.n };
    }

    const issued = await this.loginOrCreate(provider, profile, userAccessToken, ctx, fetchImpl);
    return { kind: 'login', issued: { refreshToken: issued.refreshToken }, next: st.n };
  }

  // ---- find-or-create (the account-linking policy lives here) -------------------

  private async loginOrCreate(
    provider: OAuthProvider,
    profile: ProviderProfile,
    userAccessToken: string,
    ctx: ReqCtx,
    fetchImpl: FetchImpl,
  ): Promise<{ refreshToken: string }> {
    const [linked] = await this.db
      .select()
      .from(oauthAccounts)
      .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, profile.providerUserId)))
      .limit(1);

    if (linked) {
      const [user] = await this.db.select().from(users).where(eq(users.id, linked.userId)).limit(1);
      if (!user) {
        // orphan row (user deleted out-of-band) — drop it and fall through
        await this.db.delete(oauthAccounts).where(eq(oauthAccounts.id, linked.id)).catch(() => undefined);
      } else {
        await this.refreshSnapshots(provider, profile, user.id, user.avatarUrl);
        const issued = await this.auth.openSession(user.id, ctx, provider);
        await this.maybeGuildJoin(provider, linked, userAccessToken, ctx, user.id);
        return { refreshToken: issued.refreshToken };
      }
    }

    // No provider link. A verified email matching an existing account does NOT
    // auto-merge (account-takeover risk: password accounts have unverified
    // emails) — the owner proves ownership by signing in the old way once and
    // linking explicitly from Settings.
    if (profile.email && profile.emailVerified) {
      const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, profile.email)).limit(1);
      if (existing) {
        await this.audit.record({
          actorId: existing.id,
          actorEmail: profile.email,
          action: `auth.oauth.${provider}.link_required`,
          ip: ctx.ip,
          userAgent: ctx.device,
        });
        throw Err.conflict('OAUTH_LINK_REQUIRED', 'An account with this email already exists — sign in with it first, then link from Settings');
      }
    }

    const email = profile.email && profile.emailVerified ? profile.email : `${provider}-${profile.providerUserId}@oauth.invalid`;
    try {
      const created = await this.db.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({
            name: profile.name,
            email,
            passwordHash: null,
            avatarUrl: profile.avatarUrl,
            // a verified provider email IS a verified email — no code needed
            emailVerified: profile.emailVerified,
            emailVerifiedAt: profile.emailVerified ? new Date() : null,
          })
          .returning({ id: users.id });
        await tx.insert(oauthAccounts).values({
          userId: u.id,
          provider,
          providerUserId: profile.providerUserId,
          email: profile.email,
          emailVerified: profile.emailVerified,
          avatarUrl: profile.avatarUrl,
        });
        return u;
      });
      const issued = await this.auth.openSession(created.id, ctx, provider);
      const [row] = await this.db
        .select()
        .from(oauthAccounts)
        .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, profile.providerUserId)))
        .limit(1);
      if (row) await this.maybeGuildJoin(provider, row, userAccessToken, ctx, created.id);
      return { refreshToken: issued.refreshToken };
    } catch (e) {
      // concurrent first-login race on the unique (provider, uid) index
      if ((e as { code?: string })?.code === '23505') {
        const [row] = await this.db
          .select()
          .from(oauthAccounts)
          .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, profile.providerUserId)))
          .limit(1);
        if (!row) throw Err.unavailable('OAUTH_UPSTREAM', 'Sign-in replay, please retry');
        const [user] = await this.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
        if (!user) throw Err.unavailable('OAUTH_UPSTREAM', 'Sign-in replay, please retry');
        await this.refreshSnapshots(provider, profile, user.id, user.avatarUrl);
        const issued = await this.auth.openSession(user.id, ctx, provider);
        await this.maybeGuildJoin(provider, row, userAccessToken, ctx, user.id);
        return { refreshToken: issued.refreshToken };
      }
      throw e;
    }
  }

  /** Provider snapshots refresh; the user's own avatar is only filled when empty. */
  private async refreshSnapshots(
    provider: OAuthProvider,
    profile: ProviderProfile,
    userId: string,
    currentAvatar: string | null,
  ): Promise<void> {
    await this.db
      .update(oauthAccounts)
      .set({ email: profile.email, emailVerified: profile.emailVerified, avatarUrl: profile.avatarUrl })
      .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, profile.providerUserId)))
      .catch(() => undefined);
    if (!currentAvatar && profile.avatarUrl) {
      await this.db.update(users).set({ avatarUrl: profile.avatarUrl }).where(eq(users.id, userId)).catch(() => undefined);
    }
    // the provider re-confirmed this exact address: adopt the verification
    // (only when the addresses match — never across different emails)
    if (profile.email && profile.emailVerified) {
      await this.db
        .update(users)
        .set({ emailVerified: true, emailVerifiedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.email, profile.email)))
        .catch(() => undefined);
    }
  }

  // ---- Discord guild auto-join (never fails the login) ----------------------------

  private async maybeGuildJoin(
    provider: OAuthProvider,
    row: { id: string; discordGuildJoinedAt: Date | null },
    userAccessToken: string,
    ctx: ReqCtx,
    userId: string,
  ): Promise<void> {
    if (provider !== 'discord' || !config.DISCORD_GUILD_JOIN_ENABLED) return;
    let result: Awaited<ReturnType<typeof ensureGuildMember>>;
    try {
      const [full] = await this.db.select().from(oauthAccounts).where(eq(oauthAccounts.id, row.id)).limit(1);
      result = await ensureGuildMember({
        botToken: config.DISCORD_BOT_TOKEN,
        guildId: config.DISCORD_GUILD_ID,
        userId: (await this.providerUid(row.id)) ?? '',
        userAccessToken,
        alreadyJoinedAt: full?.discordGuildJoinedAt ?? null,
      });
    } catch {
      result = { status: 'failed', reason: 'error' };
    }
    if (result.status === 'already' || result.status === 'joined') {
      await this.db
        .update(oauthAccounts)
        .set({ discordGuildJoinedAt: new Date() })
        .where(eq(oauthAccounts.id, row.id))
        .catch(() => undefined);
    }
    if (result.status !== 'cached') {
      await this.audit
        .record({
          actorId: userId,
          action: 'auth.oauth.discord.guild_join',
          targetType: 'user',
          targetId: userId,
          ip: ctx.ip,
          userAgent: ctx.device,
          meta: { status: result.status, reason: result.status === 'failed' ? result.reason : undefined },
        })
        .catch(() => undefined);
    }
  }

  private async providerUid(rowId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ providerUserId: oauthAccounts.providerUserId })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.id, rowId))
      .limit(1);
    return row?.providerUserId ?? null;
  }

  // ---- explicit linking (Settings, authenticated) ------------------------------------

  async status(userId: string) {
    const rows = await this.db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, userId));
    const [u] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return {
      hasPassword: !!u?.passwordHash,
      providers: rows.map((r) => ({
        provider: r.provider,
        email: r.email,
        createdAt: r.createdAt,
        guildJoined: !!r.discordGuildJoinedAt,
      })),
    };
  }

  async confirmLink(userId: string, linkToken: string, ctx: ReqCtx) {
    const tok = verifyLinkToken(linkToken, config.JWT_ACCESS_SECRET);
    if (!tok || tok.uid !== userId) throw Err.invalid('OAUTH_LINK_TOKEN', 'Invalid or expired link token');
    this.requireEnabled(tok.p);
    const [mine] = await this.db
      .select()
      .from(oauthAccounts)
      .where(and(eq(oauthAccounts.provider, tok.p), eq(oauthAccounts.providerUserId, tok.puid)))
      .limit(1);
    if (mine) {
      if (mine.userId === userId) return { ok: true, already: true, provider: tok.p };
      throw Err.conflict('OAUTH_ALREADY_LINKED', 'This provider account is linked to a different user');
    }
    try {
      await this.db.insert(oauthAccounts).values({
        userId,
        provider: tok.p,
        providerUserId: tok.puid,
        email: tok.em,
        emailVerified: tok.ev,
        avatarUrl: tok.av,
      });
    } catch (e) {
      if ((e as { code?: string })?.code === '23505') {
        const [again] = await this.db
          .select()
          .from(oauthAccounts)
          .where(and(eq(oauthAccounts.provider, tok.p), eq(oauthAccounts.providerUserId, tok.puid)))
          .limit(1);
        if (again?.userId === userId) return { ok: true, already: true, provider: tok.p };
        throw Err.conflict('OAUTH_ALREADY_LINKED', 'This provider account is linked to a different user');
      }
      throw e;
    }
    // a freshly linked provider may fill an empty avatar, never replace one
    if (tok.av) {
      await this.db
        .update(users)
        .set({ avatarUrl: tok.av })
        .where(and(eq(users.id, userId), isNull(users.avatarUrl)))
        .catch(() => undefined);
    }
    await this.audit.record({
      actorId: userId,
      action: `auth.oauth.${tok.p}.linked`,
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.device,
    });
    return { ok: true, already: false, provider: tok.p };
  }

  async unlink(userId: string, provider: OAuthProvider, ctx: ReqCtx) {
    if (!isOAuthProvider(provider)) throw Err.invalid('OAUTH_PROVIDER');
    const rows = await this.db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, userId));
    const target = rows.find((r) => r.provider === provider);
    if (!target) throw Err.notFound('OAUTH_NOT_LINKED');
    const [u] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u?.passwordHash && rows.length <= 1)
      throw Err.conflict('OAUTH_LAST_METHOD', 'Set a password first — this is your only sign-in method');
    await this.db.delete(oauthAccounts).where(eq(oauthAccounts.id, target.id));
    await this.audit.record({
      actorId: userId,
      action: `auth.oauth.${provider}.unlinked`,
      targetType: 'user',
      targetId: userId,
      ip: ctx.ip,
      userAgent: ctx.device,
    });
    return { ok: true, provider };
  }
}
