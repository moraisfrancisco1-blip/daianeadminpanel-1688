import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import {
  disconnectGoogleCalendar,
  exchangeCodeForTokens,
  getGoogleAuthUrl,
  getGoogleCalendarStatus,
  isGoogleCalendarConfigured,
} from "../services/google-calendar";

export const googleCalendarRoute = new Hono()
  .get("/status", requireAuth, async (c) => {
    const status = await getGoogleCalendarStatus();
    return c.json(status, 200);
  })
  .get("/connect", requireAuth, async (c) => {
    if (!isGoogleCalendarConfigured()) {
      return c.json({ message: "Google Calendar is not configured. Set GOOGLE_CLIENT_ID/SECRET." }, 400);
    }
    const url = getGoogleAuthUrl("admin-connect");
    return c.redirect(url);
  })
  .get("/callback", requireAuth, async (c) => {
    const code = c.req.query("code");
    const error = c.req.query("error");
    let result: "connected" | "error" = "error";
    if (code && !error) {
      try {
        await exchangeCodeForTokens(code);
        result = "connected";
      } catch (err) {
        console.error("[google-calendar] callback failed", err);
      }
    }
    // The connect flow runs in a popup window (Google blocks its consent screen inside
    // iframes), so notify the opener and close the popup instead of redirecting.
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Google Calendar</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f2ec;color:#2b4a45;text-align:center;padding:24px}</style></head>
<body><div><h2>${result === "connected" ? "Google Calendar connected" : "Connection failed"}</h2>
<p>${result === "connected" ? "You can close this window." : "Please close this window and try again."}</p></div>
<script>
try { if (window.opener) { window.opener.postMessage({ type: "google-calendar", result: "${result}" }, "*"); } } catch (e) {}
setTimeout(function(){ window.close(); }, 1200);
</script></body></html>`;
    return c.html(html);
  })
  .post("/disconnect", requireAuth, async (c) => {
    await disconnectGoogleCalendar();
    return c.json({ success: true }, 200);
  });
