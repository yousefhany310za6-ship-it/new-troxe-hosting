import { DISCORD_API } from './oauth.helpers';

/**
 * Discord guild auto-join, server-side only (the bot token never leaves the API).
 *
 * Idempotency: membership is checked first — a member is reported as `already`
 * without any write call, so repeat logins cost one GET and never a PUT.
 * Freshness: a join confirmed within the last 30 days is trusted (`cached`)
 * without hitting Discord at all.
 *
 * Every failure mode resolves to `{ status: 'failed', reason }` — the caller
 * (OAuth login) must NEVER fail the login because the guild join failed.
 */

export type GuildJoinResult =
  | { status: 'disabled' }
  | { status: 'cached' }
  | { status: 'already'; markJoined: true }
  | { status: 'joined'; markJoined: true }
  | { status: 'failed'; reason: string };

const MEMBER_CACHE_DAYS = 30;
const TIMEOUT_MS = 10_000;

export async function ensureGuildMember(opts: {
  botToken: string;
  guildId: string;
  userId: string;
  /** the user's own short-lived OAuth access token — used once, never stored */
  userAccessToken: string;
  alreadyJoinedAt: Date | null;
  fetchImpl?: typeof fetch;
}): Promise<GuildJoinResult> {
  const { botToken, guildId, userId, userAccessToken, alreadyJoinedAt } = opts;
  if (!botToken || !guildId) return { status: 'disabled' };
  if (!/^\d{8,32}$/.test(userId)) return { status: 'failed', reason: 'bad_user_id' };
  if (alreadyJoinedAt) {
    const ageMs = Date.now() - alreadyJoinedAt.getTime();
    if (ageMs >= 0 && ageMs < MEMBER_CACHE_DAYS * 24 * 3600 * 1000) return { status: 'cached' };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const memberUrl = `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`;
  let getRes: Response;
  try {
    getRes = await fetchImpl(memberUrl, {
      headers: { Authorization: `Bot ${botToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { status: 'failed', reason: 'network' };
  }
  if (getRes.status === 200) return { status: 'already', markJoined: true };
  if (getRes.status === 429) return { status: 'failed', reason: 'rate_limited' };
  if (getRes.status !== 404) {
    if (getRes.status === 403) return { status: 'failed', reason: 'forbidden' };
    return { status: 'failed', reason: `lookup_http_${getRes.status}` };
  }

  // 404 → not a member: the documented way to add them is PUT with the
  // user's OAuth access token in the JSON body (guilds.join scope).
  let putRes: Response;
  try {
    putRes = await fetchImpl(memberUrl, {
      method: 'PUT',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: userAccessToken }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { status: 'failed', reason: 'network' };
  }
  if (putRes.status === 201 || putRes.status === 204) return { status: 'joined', markJoined: true };
  if (putRes.status === 429) return { status: 'failed', reason: 'rate_limited' };
  if (putRes.status === 403) return { status: 'failed', reason: 'forbidden' };
  if (putRes.status === 400) return { status: 'failed', reason: 'rejected' };
  return { status: 'failed', reason: `join_http_${putRes.status}` };
}
