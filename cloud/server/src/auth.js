import crypto from "node:crypto";

export const UNAUTHORIZED_ERROR = "未授权:请检查访问口令(APP_TOKEN)";

/** 恒时比较，避免 token 被逐字符试出来。 */
export function tokenOk(given, expected) {
  if (!expected || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** 返回 HTTP 层可直接使用的授权结果，便于离线测试 401 边界。 */
export function authorizeHeader(authorization, expectedToken) {
  const match = String(authorization || "").match(/^Bearer\s+(.+)$/i);
  if (tokenOk(match?.[1].trim(), expectedToken)) return { ok: true };
  return { ok: false, status: 401, error: UNAUTHORIZED_ERROR };
}
