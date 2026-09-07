import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, admin, twoFactor } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { db } from "./database";

export const auth = betterAuth({
  basePath: "/api/auth",
  baseURL: process.env.WEBSITE_URL,
  database: drizzleAdapter(db, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: (request) => {
    const origin = request?.headers.get("origin");
    return origin ? [origin] : ["*"];
  },
  // "admin" role = full access (Daiane); "staff" = day-to-day operations only
  // (clients/calendar/bookings/packages/messages) — financial and settings
  // routes are gated to admin-only in index.ts's requireAdmin middleware.
  // Least-privilege default: any account created without an explicit role
  // (there is no public sign-up in this app) starts as "staff", never "admin".
  // "staff" isn't declared as a custom role via better-auth's access-control
  // API (its generics fight hard with a second literal role name) — instead
  // it's just a plain string this app's own requireAdmin middleware checks
  // for. better-auth's own admin-endpoint guard (adminRoles, default
  // ["admin"]) already refuses anyone whose role isn't "admin", so "staff"
  // can't call create-user/set-role/ban-user etc. even without custom ac.
  plugins: [bearer(), expo(), admin({ defaultRole: "staff" }), twoFactor({ issuer: "Studio Daï Oakes" })],
});
