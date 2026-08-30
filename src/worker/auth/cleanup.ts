import type { Env } from "../env";

export async function cleanupAuthData(
  env: Env,
  now = new Date(),
  batchSize = 100,
): Promise<{ challenges: number; emailTokens: number; sessions: number }> {
  const expiredBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sessionBefore = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM auth_webauthn_challenges WHERE id IN (
         SELECT id FROM auth_webauthn_challenges
         WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)
         ORDER BY expires_at LIMIT ?
       )`,
    ).bind(expiredBefore, expiredBefore, batchSize),
    env.DB.prepare(
      `DELETE FROM auth_email_tokens WHERE token_hash IN (
         SELECT token_hash FROM auth_email_tokens
         WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)
         ORDER BY expires_at LIMIT ?
       )`,
    ).bind(expiredBefore, expiredBefore, batchSize),
    env.DB.prepare(
      `DELETE FROM auth_sessions WHERE id IN (
         SELECT id FROM auth_sessions
         WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)
         ORDER BY expires_at LIMIT ?
       )`,
    ).bind(sessionBefore, sessionBefore, batchSize),
  ]);
  return {
    challenges: results[0].meta.changes ?? 0,
    emailTokens: results[1].meta.changes ?? 0,
    sessions: results[2].meta.changes ?? 0,
  };
}
