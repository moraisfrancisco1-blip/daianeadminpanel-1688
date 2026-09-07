import { createMiddleware } from "hono/factory";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Machine-to-machine auth for the read-only Volt Core service connector —
 * completely separate from human sessions (better-auth) and from any other
 * service key this app or a sibling app may ever have. Never reuse this
 * across connectors: a second consumer gets its own env var and its own
 * dedicated route, so revoking one can never affect another.
 *
 * Deliberately NOT a Bearer/JWT — there is nothing to decode or trust
 * client-side; the header value is opaque and checked by exact match only.
 */
const HEADER = "X-Volt-Core-Key";
const ENV_VAR = "VOLT_CORE_SERVICE_KEY_DAIOAKES";

/** Hash-then-compare so mismatched lengths never short-circuit the timing, and the raw key is never held next to attacker input. */
function safeCompare(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const requireServiceKey = createMiddleware(async (c, next) => {
  const expected = process.env[ENV_VAR];
  if (!expected) {
    // Fail CLOSED — unlike the login-rate-limit path, a missing key here
    // means the connector was never configured, not a transient hiccup.
    console.error(`[service-key] ${ENV_VAR} is not set — refusing all service-key requests.`);
    return c.json({ message: "Forbidden" }, 403);
  }

  const provided = c.req.header(HEADER);
  if (!provided || !safeCompare(provided, expected)) {
    return c.json({ message: "Forbidden" }, 403);
  }

  return next();
});
