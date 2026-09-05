import { createMiddleware } from "hono/factory";
import { db } from "../database";
import { rateLimitHits } from "../database/schema";
import { and, eq, gte, lt } from "drizzle-orm";

/** Best-effort client IP from standard proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/**
 * DB-backed sliding-window rate limit: counts hits for `key` in the last
 * `windowMs`, then records this one. Returns true when the request is
 * allowed. Opportunistically prunes this key's own hits older than the
 * window so the table doesn't grow unbounded.
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMs);
  const recent = await db.select().from(rateLimitHits).where(and(eq(rateLimitHits.key, key), gte(rateLimitHits.createdAt, windowStart)));
  await db.delete(rateLimitHits).where(and(eq(rateLimitHits.key, key), lt(rateLimitHits.createdAt, windowStart)));
  if (recent.length >= limit) return false;
  await db.insert(rateLimitHits).values({ key });
  return true;
}

/** Hono middleware: rate-limits requests matching `method` by client IP. */
export function rateLimitByIp(opts: { method: string; prefix: string; limit: number; windowMs: number }) {
  return createMiddleware(async (c, next) => {
    if (c.req.method !== opts.method) return next();
    const ip = clientIp(c.req.raw.headers);
    try {
      const allowed = await checkRateLimit(`${opts.prefix}:${ip}`, opts.limit, opts.windowMs);
      if (!allowed) return c.json({ message: "Too many requests — please try again later." }, 429);
    } catch (err) {
      // Fail OPEN: this is the login/booking path — a DB hiccup (or the
      // migration not having run yet) must never lock out real users.
      console.error("[rate-limit] check failed, allowing request:", err);
    }
    return next();
  });
}
