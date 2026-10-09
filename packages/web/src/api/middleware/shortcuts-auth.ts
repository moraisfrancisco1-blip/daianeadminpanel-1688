import { createMiddleware } from "hono/factory";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Bearer-token auth for the iPhone Shortcuts / Scriptable widget endpoints —
 * its own token (SHORTCUTS_TOKEN), never shared with the Volt Core service key
 * or with human sessions, so rotating it (change the env var) revokes only the
 * phone. Fails CLOSED when the variable is not set.
 */
function safeCompare(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const requireShortcutsToken = createMiddleware(async (c, next) => {
  const expected = process.env.SHORTCUTS_TOKEN;
  if (!expected) {
    console.error("[shortcuts] SHORTCUTS_TOKEN is not set — refusing all shortcut requests.");
    return c.json({ message: "Forbidden" }, 403);
  }
  const header = c.req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !safeCompare(provided, expected)) return c.json({ message: "Forbidden" }, 403);
  return next();
});
