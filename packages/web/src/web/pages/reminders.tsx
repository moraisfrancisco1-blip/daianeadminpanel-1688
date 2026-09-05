import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { RefreshCw, CalendarCheck, CalendarX, Link2Off } from "lucide-react";
import { useEffect, useState } from "react";

export default function RemindersPage() {
  return (
    <Protected>
      <RemindersContent />
    </Protected>
  );
}

function RemindersContent() {
  const qc = useQueryClient();
  const overdue = useQuery({
    queryKey: ["overdue"],
    queryFn: async () => (await api.reminders.overdue.$get()).json(),
  });

  const runCheck = useMutation({
    mutationFn: async () => (await api.reminders.run.$post()).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overdue"] }),
  });

  const calendarStatus = useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: async () => (await api["google-calendar"].status.$get()).json(),
  });

  const disconnectCalendar = useMutation({
    mutationFn: async () => (await api["google-calendar"].disconnect.$post()).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["google-calendar-status"] }),
  });

  // These endpoints return either the real payload or a plain `{ message }` error
  // object, so narrow with an `in` check before touching payload-only fields.
  const calendarStatusData =
    calendarStatus.data && "configured" in calendarStatus.data ? calendarStatus.data : null;
  const isConnected = !!calendarStatusData?.connected;
  const calendars = useQuery({
    queryKey: ["google-calendar-list"],
    queryFn: async () => (await api["google-calendar"].calendars.$get()).json(),
    enabled: isConnected,
  });
  const calendarsList = calendars.data && "calendars" in calendars.data ? calendars.data.calendars : [];
  const overdueList = overdue.data && "overdue" in overdue.data ? overdue.data.overdue : [];

  const selectCalendar = useMutation({
    mutationFn: async (calendarId: string) =>
      (await api["google-calendar"]["select-calendar"].$post({ json: { calendarId } })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["google-calendar-status"] }),
  });

  const [calendarBanner, setCalendarBanner] = useState<"connected" | "error" | null>(null);
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "google-calendar") {
        setCalendarBanner(e.data.result === "connected" ? "connected" : "error");
        qc.invalidateQueries({ queryKey: ["google-calendar-status"] });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc]);

  function connectCalendar() {
    const w = 520;
    const h = 640;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    window.open(
      "/api/google-calendar/connect",
      "google-calendar-connect",
      `width=${w},height=${h},left=${left},top=${top}`,
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Payment Reminders</h1>
          <p className="text-muted-foreground mt-1">Auto-sent 10 days after an invoice's due date</p>
        </div>
        <Button onClick={() => runCheck.mutate()} disabled={runCheck.isPending}>
          <RefreshCw className={`size-4 ${runCheck.isPending ? "animate-spin" : ""}`} /> Run check now
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-medium mb-1">Google Calendar sync</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Confirmed bookings are created directly on your Google Calendar (with a guest invite sent to the
          patient's email), and busy slots from your calendar are removed from the public booking availability.
        </p>

        {calendarBanner === "connected" && (
          <div className="mb-3 rounded-md bg-green-50 text-green-700 text-sm px-3 py-2">
            Google Calendar connected successfully.
          </div>
        )}
        {calendarBanner === "error" && (
          <div className="mb-3 rounded-md bg-red-50 text-red-700 text-sm px-3 py-2">
            Couldn't connect Google Calendar. Please try again.
          </div>
        )}

        {!calendarStatus.isLoading && !calendarStatusData?.configured && (
          <div className="rounded-md bg-secondary/50 text-sm px-3 py-2 text-muted-foreground">
            Not configured yet — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the app's environment variables
            first.
          </div>
        )}

        {calendarStatusData?.configured && (
          <div className="flex items-center justify-between flex-wrap gap-3">
            {calendarStatusData.connected ? (
              <div className="flex items-center gap-2 text-sm text-green-700">
                <CalendarCheck className="size-4" /> Connected as {calendarStatusData.email}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarX className="size-4" /> Not connected
              </div>
            )}
            <div>
              {calendarStatusData.connected ? (
                <Button
                  variant="outline"
                  onClick={() => disconnectCalendar.mutate()}
                  disabled={disconnectCalendar.isPending}
                >
                  <Link2Off className="size-4" /> Disconnect
                </Button>
              ) : (
                <Button onClick={connectCalendar}>Connect Google Calendar</Button>
              )}
            </div>
          </div>
        )}

        {calendarStatusData?.configured && isConnected && (
          <div className="mt-4 border-t border-border pt-4">
            <label className="block text-sm font-medium mb-1">Agenda de agendamentos</label>
            <p className="text-xs text-muted-foreground mb-2">
              Escolha em qual agenda da sua conta os agendamentos confirmados devem ser criados. As demais
              agendas também são respeitadas na disponibilidade.
            </p>
            <select
              className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={calendarStatusData.selectedCalendarId ?? "primary"}
              disabled={calendars.isLoading || selectCalendar.isPending}
              onChange={(e) => selectCalendar.mutate(e.target.value)}
            >
              {calendars.isLoading && <option>Carregando agendas…</option>}
              {calendarsList
                .filter((cal) => cal.accessRole === "owner" || cal.accessRole === "writer")
                .map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.summary}
                    {cal.primary ? " (principal)" : ""}
                  </option>
                ))}
            </select>
            {selectCalendar.isPending && (
              <p className="text-xs text-muted-foreground mt-1">Salvando…</p>
            )}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-medium mb-1">Fully automated</h3>
        <p className="text-sm text-muted-foreground">
          A daily Vercel Cron Job runs all reminder checks automatically at 06:00 UTC, even on days nobody opens the
          dashboard — no third-party service needed. One-time setup: add a <code className="font-mono">CRON_SECRET</code>{" "}
          environment variable in the Vercel project settings (any random string) and redeploy. Until it's set, this
          only runs when you open this page or click "Run check now" above.
        </p>
      </div>

      {overdue.isLoading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Invoice #</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Due date</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Reminders sent</th>
              </tr>
            </thead>
            <tbody>
              {overdueList.map((inv) => (
                <tr key={inv.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3">{inv.clientName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(inv.dueDate).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3 font-medium">€{inv.total.toFixed(2)}</td>
                  <td className="px-4 py-3">{inv.reminderCount}</td>
                </tr>
              ))}
              {overdueList.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No overdue invoices. 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
