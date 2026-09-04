import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Link } from "wouter";
import {
  Users,
  Receipt,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CalendarClock,
  Plus,
  UserPlus,
  Bell,
  Sparkles,
  CreditCard,
  Euro,
  CheckCircle2,
  Cake,
  MoreVertical,
  Mail,
  MessageCircle,
  Smartphone,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, AreaChart, Area } from "recharts";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";

function serviceAccent(name?: string | null): { bg: string } {
  const n = (name ?? "").toLowerCase();
  if (n.includes("massage")) return { bg: "bg-brand-bronze" };
  if (n.includes("recovery") || n.includes("postpartum")) return { bg: "bg-brand-copper" };
  if (n.includes("pregnancy") || n.includes("birth")) return { bg: "bg-brand-teal" };
  return { bg: "bg-muted-foreground" };
}

function weekdayDateLabel(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export default function DashboardPage() {
  return (
    <Protected>
      <DashboardContent />
    </Protected>
  );
}

function DashboardContent() {
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<{ month: number; year: number } | null>(null);

  // Default to current month when none selected
  const now = new Date();
  const activeMonth = selectedMonth ?? { month: now.getMonth() + 1, year: now.getFullYear() };
  const monthLabel = selectedMonth
    ? new Date(selectedMonth.year, selectedMonth.month - 1).toLocaleString("en-GB", { month: "long", year: "numeric" })
    : "this month";

  const stats = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async (): Promise<any> => (await api.dashboard.stats.$get()).json(),
  });
  const revenueChart = useQuery({
    queryKey: ["dashboard-revenue-chart"],
    queryFn: async (): Promise<any> => (await api.dashboard["revenue-chart"].$get({ query: { months: "6" } })).json(),
  });
  const serviceBreakdown = useQuery({
    queryKey: ["dashboard-service-breakdown"],
    queryFn: async (): Promise<any> => (await api.dashboard["service-breakdown"].$get()).json(),
  });
  const sessionsThisMonthByService = useQuery({
    queryKey: ["dashboard-sessions-this-month-by-service"],
    queryFn: async (): Promise<any> => (await api.dashboard["sessions-this-month-by-service"].$get()).json(),
  });
  const topClients = useQuery({
    queryKey: ["dashboard-top-clients"],
    queryFn: async (): Promise<any> => (await api.dashboard["top-clients"].$get({ query: { limit: "5" } })).json(),
  });
  const upcomingBookings = useQuery({
    queryKey: ["dashboard-upcoming"],
    queryFn: async (): Promise<any> => (await api.dashboard["upcoming-bookings"].$get({ query: { limit: "6" } })).json(),
  });
  const vatSummary = useQuery({
    queryKey: ["dashboard-vat", activeMonth.year, activeMonth.month],
    queryFn: async (): Promise<any> => (await api.dashboard["vat-summary"].$get({ query: { year: String(activeMonth.year), month: String(activeMonth.month) } })).json(),
  });
  const activityFeed = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: async (): Promise<any> => (await api.dashboard["activity-feed"].$get({ query: { limit: "10" } })).json(),
  });
  const overdue = useQuery({
    queryKey: ["overdue"],
    queryFn: async (): Promise<any> => (await api.reminders.overdue.$get()).json(),
  });
  const stripeCommissions = useQuery({
    queryKey: ["dashboard-stripe-commissions", activeMonth.year, activeMonth.month],
    queryFn: async (): Promise<any> => (await api.dashboard["stripe-commissions"].$get({ query: { year: String(activeMonth.year), month: String(activeMonth.month) } })).json(),
    refetchInterval: 60000,
  });
  const todayData = useQuery({
    queryKey: ["dashboard-today"],
    queryFn: async (): Promise<any> => (await api.dashboard.today.$get()).json(),
    refetchInterval: 60000,
  });
  const alertsData = useQuery({
    queryKey: ["dashboard-alerts"],
    queryFn: async (): Promise<any> => (await api.dashboard.alerts.$get()).json(),
  });
  const birthdaysData = useQuery({
    queryKey: ["dashboard-upcoming-birthdays"],
    queryFn: async (): Promise<any> => (await api.dashboard["upcoming-birthdays"].$get()).json(),
  });

  // best-effort trigger of overdue reminder check on load (fallback automation)
  useQuery({
    queryKey: ["reminders-auto-check"],
    queryFn: async () => (await api.reminders.run.$post()).json(),
    staleTime: 1000 * 60 * 60,
  });

  const sendReminderNow = useMutation({
    mutationFn: async (invoiceId: number) =>
      (await api.reminders[":invoiceId"]["send-now"].$post({ param: { invoiceId: String(invoiceId) } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["overdue"] });
      setToast("Reminder sent.");
      setTimeout(() => setToast(null), 3000);
    },
  });

  const resolveNoteFromDashboard = useMutation({
    mutationFn: async (p: { clientId: number; noteId: number }) =>
      (
        await api.clients[":id"].notes[":noteId"].resolve.$put({
          param: { id: String(p.clientId), noteId: String(p.noteId) },
        } as any)
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-alerts"] });
    },
  });

  return (
    <div className="space-y-8">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-md text-sm font-medium bg-[#4C7A56] text-white">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-brand-teal">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your business · {weekdayDateLabel()}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/invoices">
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90">
              <Plus className="size-4" /> New Invoice
            </button>
          </Link>
          <Link to="/clients">
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent">
              <UserPlus className="size-4" /> New Client
            </button>
          </Link>
          <Link to="/bookings">
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent">
              <CalendarClock className="size-4" /> Bookings
            </button>
          </Link>
        </div>
      </div>

      {/* Hero: revenue this month + at-a-glance tiles */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RevenueHero
          loading={stats.isLoading || revenueChart.isLoading}
          revenueThisMonth={stats.data?.revenueThisMonth ?? 0}
          prevMonthRevenue={stats.data?.prevMonthRevenue ?? 0}
          chartData={revenueChart.data?.chart ?? []}
        />
        <div className="grid grid-cols-2 gap-4">
          <MiniTile icon={Users} label="Total clients" value={stats.data?.totalClients ?? 0} loading={stats.isLoading} />
          <MiniTile
            icon={Euro}
            label="Total revenue (net)"
            value={`€${(stats.data?.totalRevenue ?? 0).toFixed(2)}`}
            loading={stats.isLoading}
          />
          <MiniTile
            icon={AlertTriangle}
            label="Overdue invoices"
            value={stats.data?.overdueCount ?? 0}
            tone="danger"
            loading={stats.isLoading}
          />
          <MiniTile
            icon={Receipt}
            label="Outstanding total"
            value={`€${(stats.data?.outstandingTotal ?? 0).toFixed(2)}`}
            loading={stats.isLoading}
          />
        </div>
      </div>

      {/* O meu dia — today's focus */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-display text-lg font-medium mb-1">O meu dia</h3>
        <p className="text-xs text-muted-foreground mb-4">
          {(todayData.data?.sessions ?? []).length} sessõe{(todayData.data?.sessions ?? []).length === 1 ? "" : "s"} agendada
          {(todayData.data?.sessions ?? []).length === 1 ? "" : "s"} para hoje
        </p>
        {todayData.isLoading ? (
          <div className="h-24 bg-muted rounded animate-pulse" />
        ) : (
          <div className="divide-y divide-border">
            {(todayData.data?.sessions ?? []).map((s: any) => {
              const accent = serviceAccent(s.serviceName);
              const initials = (s.name ?? "")
                .split(/\s+/)
                .slice(0, 2)
                .map((p: string) => p[0])
                .join("")
                .toUpperCase();
              return (
                <div key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="w-12 shrink-0 text-sm text-muted-foreground">{s.startTime}</span>
                  <span
                    className={cn("size-9 shrink-0 rounded-full flex items-center justify-center text-white text-xs font-display font-semibold", accent.bg)}
                  >
                    {initials || "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {s.serviceName} — {s.durationMinutes} min
                    </p>
                  </div>
                  {s.status === "confirmed" ? (
                    <span className="shrink-0 flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-[#4C7A56]/12 text-[#3F6B52]">
                      <CheckCircle2 className="size-3.5" /> Confirmed
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full bg-muted text-muted-foreground capitalize">
                      {s.status?.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              );
            })}
            {(todayData.data?.sessions ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No more clients today.</p>
            )}
          </div>
        )}
        {!todayData.isLoading && todayData.data?.nextClient && (
          <div className="mt-3 pt-3 border-t border-border text-sm">
            <p className="text-xs text-muted-foreground">Próximo cliente</p>
            <p className="font-medium">
              {todayData.data.nextClient.startTime} · {todayData.data.nextClient.name} — {todayData.data.nextClient.serviceName}
            </p>
          </div>
        )}
        {!todayData.isLoading && todayData.data?.nextClient == null && (todayData.data?.confirmedCount ?? 0) > 0 && (
          <div className="mt-3 pt-3 border-t border-border text-sm">
            <p className="text-xs text-muted-foreground">Próximo cliente</p>
            <p className="font-medium text-muted-foreground">No more clients today.</p>
          </div>
        )}
      </div>

      {/* Upcoming birthdays */}
      {(birthdaysData.data?.upcoming ?? []).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-display text-lg font-medium mb-1 flex items-center gap-2">
            <Cake className="size-4 text-brand-copper" /> Upcoming birthdays
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Next 7 days</p>
          <div className="divide-y divide-border">
            {(birthdaysData.data?.upcoming ?? []).map((b: any) => (
              <BirthdayRow key={b.clientId} birthday={b} />
            ))}
          </div>
        </div>
      )}

      {/* Financial summary — faturado vs recebido vs pendente + sessões por serviço */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BillingRingCard
          loading={stats.isLoading}
          billed={stats.data?.billedThisMonth ?? 0}
          paid={stats.data?.paidThisMonth ?? 0}
          pending={stats.data?.pendingTotal ?? 0}
          prevMonthRevenue={stats.data?.prevMonthRevenue ?? 0}
        />
        <SessionsBarCard
          loading={stats.isLoading || sessionsThisMonthByService.isLoading}
          sessionsThisMonth={stats.data?.sessionsThisMonth ?? 0}
          totalSessions={stats.data?.totalSessions ?? 0}
          breakdown={sessionsThisMonthByService.data?.breakdown ?? []}
        />
      </div>

      {/* Received so far this week / year */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard icon={Euro} label="Recebido hoje" value={`€${(stats.data?.revenueToday ?? 0).toFixed(2)}`} />
        <StatCard icon={Euro} label="Recebido esta semana" value={`€${(stats.data?.revenueThisWeek ?? 0).toFixed(2)}`} />
        <StatCard icon={Euro} label="Recebido este ano" value={`€${(stats.data?.revenueThisYear ?? 0).toFixed(2)}`} />
      </div>

      {/* Alertas inteligentes */}
      {(alertsData.data?.alerts ?? []).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4 flex items-center gap-2">
            <AlertTriangle className="size-4 text-brand-copper" /> Alertas
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(alertsData.data?.alerts ?? []).map((a: any) => (
              <Link
                key={a.id}
                to={a.link}
                className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 hover:bg-accent/40 transition-colors"
              >
                <span
                  className={`mt-1.5 size-2 rounded-full shrink-0 ${
                    a.severity === "high" ? "bg-destructive" : a.severity === "medium" ? "bg-brand-bronze" : "bg-brand-teal"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{a.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{a.detail}</p>
                </div>
                {a.noteId && a.clientId && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      resolveNoteFromDashboard.mutate({ clientId: a.clientId, noteId: a.noteId });
                    }}
                    disabled={resolveNoteFromDashboard.isPending}
                    className="text-xs font-medium text-brand-teal hover:underline shrink-0 disabled:opacity-50"
                  >
                    Tratada
                  </button>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Revenue chart + VAT summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">Revenue — last 6 months</h3>
            {selectedMonth && (
              <button
                onClick={() => setSelectedMonth(null)}
                className="text-xs text-brand-copper hover:underline font-medium"
              >
                ← Back to current month
              </button>
            )}
          </div>
          {revenueChart.isLoading ? (
            <div className="h-56 bg-muted rounded animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={revenueChart.data?.chart ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EBDFCF" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6B6259" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#6B6259" }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: any) => [`€${Number(v).toFixed(2)}`, "Revenue"]}
                  contentStyle={{ borderRadius: 8, borderColor: "#EBDFCF", fontSize: 12 }}
                  cursor={{ fill: "rgba(174,99,63,0.1)" }}
                />
                <Bar
                  dataKey="revenue"
                  fill="#AE633F"
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(data: any) => {
                    const payload = data?.payload;
                    if (payload?.month) {
                      const [y, m] = payload.month.split("-").map(Number);
                      setSelectedMonth({ year: y, month: m });
                    }
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4">VAT — {monthLabel}</h3>
          {vatSummary.isLoading ? (
            <div className="h-40 bg-muted rounded animate-pulse" />
          ) : (
            <div className="space-y-3">
              {(vatSummary.data?.breakdown ?? []).map((b: any) => (
                <div key={b.rate} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">VAT {Math.round(b.rate * 100)}%</span>
                  <span className="font-medium">€{b.vat.toFixed(2)}</span>
                </div>
              ))}
              {(vatSummary.data?.breakdown ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No paid invoices this month yet.</p>
              )}
              <div className="pt-3 border-t border-border flex items-center justify-between">
                <span className="text-sm font-medium">Total VAT to remit</span>
                <span className="font-display text-lg text-brand-copper">€{(vatSummary.data?.totalVat ?? 0).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stripe commissions */}
      {stripeCommissions.data && stripeCommissions.data.available !== false && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4 flex items-center gap-2">
            <CreditCard className="size-4 text-brand-copper" /> Stripe Commissions — {monthLabel}
            <span className="ml-auto text-xs text-muted-foreground">Auto-refreshes every 60s</span>
          </h3>
          {stripeCommissions.isLoading ? (
            <div className="h-20 bg-muted rounded animate-pulse" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Gross revenue</p>
                <p className="text-xl font-display font-semibold">€{(stripeCommissions.data.totalGross ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Stripe fees</p>
                <p className="text-xl font-display font-semibold text-destructive">€{(stripeCommissions.data.totalFees ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Net received</p>
                <p className="text-xl font-display font-semibold text-[#4C7A56]">€{(stripeCommissions.data.totalNet ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Transactions</p>
                <p className="text-xl font-display font-semibold">{stripeCommissions.data.transactionCount ?? 0}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Service breakdown + Top clients */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4">Services — revenue &amp; popularity</h3>
          {serviceBreakdown.isLoading ? (
            <div className="h-40 bg-muted rounded animate-pulse" />
          ) : (
            <div className="space-y-3">
              {(serviceBreakdown.data?.breakdown ?? []).slice(0, 6).map((s: any) => (
                <div key={s.name} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.count} session{s.count === 1 ? "" : "s"}</p>
                  </div>
                  <span className="font-medium text-brand-copper">€{s.revenue.toFixed(2)}</span>
                </div>
              ))}
              {(serviceBreakdown.data?.breakdown ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No paid invoices yet.</p>
              )}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4">Top clients</h3>
          {topClients.isLoading ? (
            <div className="h-40 bg-muted rounded animate-pulse" />
          ) : (
            <div className="space-y-3">
              {(topClients.data?.topClients ?? []).map((tc: any, i: number) => (
                <div key={tc.clientId} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="size-5 rounded-full bg-brand-teal text-white text-[10px] flex items-center justify-center font-medium">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-medium">{tc.name}</p>
                      <p className="text-xs text-muted-foreground">{tc.sessionCount} paid invoice{tc.sessionCount === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                  <span className="font-medium text-brand-copper">€{tc.revenue.toFixed(2)}</span>
                </div>
              ))}
              {(topClients.data?.topClients ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No paid invoices yet.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Upcoming bookings + Overdue + Activity feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4 flex items-center gap-2">
            <CalendarClock className="size-4 text-brand-copper" /> Upcoming bookings
          </h3>
          {upcomingBookings.isLoading ? (
            <div className="h-40 bg-muted rounded animate-pulse" />
          ) : (
            <div className="space-y-3">
              {(upcomingBookings.data?.upcoming ?? []).map((b: any) => (
                <div key={b.id} className="text-sm">
                  <p className="font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {b.serviceName} · {new Date(b.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} at {b.startTime}
                  </p>
                </div>
              ))}
              {(upcomingBookings.data?.upcoming ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No upcoming confirmed bookings.</p>
              )}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4 flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" /> Overdue invoices
          </h3>
          {overdue.isLoading ? (
            <div className="h-40 bg-muted rounded animate-pulse" />
          ) : (
            <div className="space-y-3">
              {(overdue.data?.overdue ?? []).slice(0, 6).map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between text-sm gap-2">
                  <div>
                    <p className="font-medium">{inv.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">{inv.clientName} · €{inv.total.toFixed(2)}</p>
                  </div>
                  <button
                    onClick={() => sendReminderNow.mutate(inv.id)}
                    disabled={sendReminderNow.isPending && sendReminderNow.variables === inv.id}
                    className="shrink-0 flex items-center gap-1 text-xs font-medium text-brand-copper hover:underline disabled:opacity-50"
                  >
                    <Bell className="size-3" /> Remind
                  </button>
                </div>
              ))}
              {(overdue.data?.overdue ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No overdue invoices. 🎉</p>
              )}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4 flex items-center gap-2">
            <Sparkles className="size-4 text-brand-copper" /> Recent activity
          </h3>
          {activityFeed.isLoading ? (
            <div className="h-40 bg-muted rounded animate-pulse" />
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {(activityFeed.data?.events ?? []).map((e: any, i: number) => (
                <div key={i} className="text-xs">
                  <p className="text-muted-foreground">{new Date(e.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
                  <p>{e.text}</p>
                </div>
              ))}
              {(activityFeed.data?.events ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone?: "danger";
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={tone === "danger" ? "size-4 text-destructive" : "size-4 text-primary"} />
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
      </div>
      <p className={`text-2xl font-display font-semibold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

function MiniTile({
  icon: Icon,
  label,
  value,
  tone,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone?: "danger";
  loading?: boolean;
}) {
  if (loading) return <div className="h-24 rounded-xl bg-muted animate-pulse" />;
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col">
      <span
        className={cn(
          "size-8 rounded-full flex items-center justify-center mb-2",
          tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-brand-copper/10 text-brand-copper",
        )}
      >
        <Icon className="size-4" />
      </span>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-display font-semibold mt-0.5", tone === "danger" && "text-destructive")}>{value}</p>
    </div>
  );
}

function RevenueHero({
  loading,
  revenueThisMonth,
  prevMonthRevenue,
  chartData,
}: {
  loading?: boolean;
  revenueThisMonth: number;
  prevMonthRevenue: number;
  chartData: { label: string; revenue: number }[];
}) {
  const trendPct = prevMonthRevenue > 0 ? ((revenueThisMonth - prevMonthRevenue) / prevMonthRevenue) * 100 : null;

  return (
    <div className="lg:col-span-2 rounded-xl p-6 bg-gradient-to-br from-brand-teal to-brand-teal-dark text-brand-cream flex flex-col">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-cream/55">Receita deste mês</p>
      {loading ? (
        <div className="h-32 mt-2 bg-white/5 rounded animate-pulse" />
      ) : (
        <>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="font-display text-4xl md:text-5xl font-semibold text-white">€{revenueThisMonth.toFixed(0)}</span>
            {trendPct !== null && (
              <span
                className={cn(
                  "flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full",
                  trendPct >= 0 ? "bg-emerald-400/20 text-emerald-300" : "bg-red-400/20 text-red-300",
                )}
              >
                {trendPct >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                {trendPct >= 0 ? "+" : ""}
                {trendPct.toFixed(0)}%
              </span>
            )}
          </div>
          <p className="text-xs text-brand-cream/50 mt-1">vs. €{prevMonthRevenue.toFixed(0)} no mês passado</p>
          <div className="mt-4 -mx-2 flex-1 min-h-[100px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="heroRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D9915F" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#D9915F" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="revenue" stroke="#D9915F" strokeWidth={2} fill="url(#heroRevenueGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function BillingRingCard({
  loading,
  billed,
  paid,
  pending,
  prevMonthRevenue,
}: {
  loading?: boolean;
  billed: number;
  paid: number;
  pending: number;
  prevMonthRevenue: number;
}) {
  const total = paid + pending + billed || 1;
  const paidPct = (paid / total) * 100;
  const pendingPct = (pending / total) * 100;
  const billedPct = Math.max(0, 100 - paidPct - pendingPct);
  const ringStyle = {
    background: `conic-gradient(#4C7A56 0% ${paidPct}%, #AE633F ${paidPct}% ${paidPct + pendingPct}%, #EBDFCF ${paidPct + pendingPct}% 100%)`,
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h3 className="font-display text-lg font-medium">Este mês — Faturado vs Recebido vs Pendente</h3>
      <p className="text-xs text-muted-foreground mb-4">Estado de cobrança em tempo real</p>
      {loading ? (
        <div className="h-40 bg-muted rounded animate-pulse" />
      ) : (
        <div className="flex items-center gap-6 flex-wrap">
          <div className="relative size-36 shrink-0 mx-auto">
            <div className="absolute inset-0 rounded-full" style={ringStyle} />
            <div className="absolute inset-[12px] rounded-full bg-card flex flex-col items-center justify-center text-center px-2">
              <span className="font-display text-lg font-semibold text-brand-copper leading-tight">€{pending.toFixed(0)}</span>
              <span className="text-[10px] text-muted-foreground">pendente</span>
            </div>
          </div>
          <div className="flex-1 min-w-[180px] space-y-3">
            <RingLegendRow dotClass="bg-[#4C7A56]" barClass="bg-[#4C7A56]" label="Recebido" value={paid} pct={paidPct} />
            <RingLegendRow dotClass="bg-brand-copper" barClass="bg-brand-copper" label="Pendente" value={pending} pct={pendingPct} />
            <RingLegendRow dotClass="bg-brand-beige border border-border" barClass="bg-brand-beige" label="Faturado (emitido)" value={billed} pct={billedPct} />
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-4">Mês passado: €{prevMonthRevenue.toFixed(2)} recebidos.</p>
    </div>
  );
}

function RingLegendRow({
  dotClass,
  barClass,
  label,
  value,
  pct,
}: {
  dotClass: string;
  barClass: string;
  label: string;
  value: number;
  pct: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={cn("size-2 rounded-full shrink-0", dotClass)} />
        {label}
      </div>
      <p className="font-display text-base font-semibold ml-4">€{value.toFixed(2)}</p>
      <div className="ml-4 mt-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-40">
        <div className={cn("h-full rounded-full", barClass)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function SessionsBarCard({
  loading,
  sessionsThisMonth,
  totalSessions,
  breakdown,
}: {
  loading?: boolean;
  sessionsThisMonth: number;
  totalSessions: number;
  breakdown: { name: string; count: number }[];
}) {
  const sum = breakdown.reduce((s, b) => s + b.count, 0) || 1;

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h3 className="font-display text-lg font-medium">Sessões — mês / total</h3>
      <p className="text-xs text-muted-foreground mb-4">
        {sessionsThisMonth} de {totalSessions} sessões utilizadas este mês
      </p>
      {loading ? (
        <div className="h-24 bg-muted rounded animate-pulse" />
      ) : (
        <>
          <div className="h-3 rounded-full overflow-hidden flex bg-muted">
            {breakdown.map((b) => {
              const accent = serviceAccent(b.name);
              return (
                <div
                  key={b.name}
                  className={accent.bg}
                  style={{ width: `${(b.count / sum) * 100}%` }}
                  title={`${b.name}: ${b.count}`}
                />
              );
            })}
            {breakdown.length === 0 && <div className="w-full bg-muted" />}
          </div>
          <div className="mt-4 space-y-2">
            {breakdown.map((b) => {
              const accent = serviceAccent(b.name);
              return (
                <div key={b.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className={cn("size-2.5 rounded-sm shrink-0", accent.bg)} />
                    {b.name}
                  </span>
                  <span className="font-medium">{b.count}</span>
                </div>
              );
            })}
            {breakdown.length === 0 && <p className="text-sm text-muted-foreground">No sessions this month yet.</p>}
          </div>
        </>
      )}
    </div>
  );
}

const BIRTHDAY_TEMPLATE = "Hi {{name}}, today is your special day — wishing you a very happy birthday! 🎂💛 With love from Studio Daï Oakes.";

function BirthdayRow({
  birthday,
}: {
  birthday: {
    clientId: number;
    name: string;
    email: string | null;
    phone: string | null;
    date: string;
    daysUntil: number;
    hasSessionThatDay: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  const [smsStatus, setSmsStatus] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const message = BIRTHDAY_TEMPLATE.replace("{{name}}", birthday.name);
  const phoneDigits = birthday.phone?.replace(/[^\d+]/g, "");
  const waLink = phoneDigits ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}` : null;
  const mailLink = birthday.email
    ? `mailto:${birthday.email}?subject=${encodeURIComponent("Happy Birthday! 🎂")}&body=${encodeURIComponent(message)}`
    : null;

  async function sendSms() {
    if (!birthday.phone) return;
    setSmsStatus("Sending…");
    try {
      const res = await api.sms.send.$post({
        json: { to: birthday.phone, message, clientId: birthday.clientId, templateId: "birthday" },
      });
      const data = (await res.json()) as { success?: boolean };
      if (!res.ok || !data.success) throw new Error();
      setSmsStatus("Sent ✓");
    } catch {
      setSmsStatus("Failed");
    } finally {
      setTimeout(() => setSmsStatus(null), 2500);
    }
    setOpen(false);
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex items-center gap-2">
        <span className="size-2 rounded-full bg-brand-copper shrink-0" />
        <div className="min-w-0">
          <Link to={`/clients/${birthday.clientId}`} className="text-sm font-medium hover:underline">
            {birthday.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {birthday.daysUntil === 0 ? "Today 🎉" : `In ${birthday.daysUntil} day${birthday.daysUntil === 1 ? "" : "s"}`}
            {birthday.hasSessionThatDay && " · has a session booked"}
          </p>
        </div>
      </div>
      <div className="relative shrink-0" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title="Send message"
        >
          <MoreVertical className="size-4" />
        </button>
        {open && (
          <div className="absolute right-0 mt-1 w-56 rounded-lg border border-border bg-card shadow-lg py-1.5 z-50">
            {smsStatus ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">{smsStatus}</p>
            ) : (
              <>
                <a
                  href={mailLink ?? undefined}
                  onClick={(e) => {
                    if (!mailLink) e.preventDefault();
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors",
                    !mailLink && "opacity-40 pointer-events-none",
                  )}
                >
                  <Mail className="size-4" /> Send Email
                </a>
                <a
                  href={waLink ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    if (!waLink) e.preventDefault();
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors",
                    !waLink && "opacity-40 pointer-events-none",
                  )}
                >
                  <MessageCircle className="size-4" /> Send WhatsApp
                </a>
                <button
                  onClick={sendSms}
                  disabled={!birthday.phone}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-40"
                >
                  <Smartphone className="size-4" /> Send SMS
                </button>
                <Link
                  to={`/messages?clientId=${birthday.clientId}&template=birthday`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm border-t border-border mt-1 pt-2 text-muted-foreground hover:bg-accent transition-colors"
                >
                  Edit message…
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
