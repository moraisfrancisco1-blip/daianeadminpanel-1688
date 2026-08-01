import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Link } from "wouter";
import {
  Users,
  Receipt,
  TrendingUp,
  AlertTriangle,
  CalendarClock,
  Plus,
  FileText,
  UserPlus,
  Bell,
  Sparkles,
  CreditCard,
  Euro,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { useState } from "react";

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
    queryFn: async () => (await api.dashboard.stats.$get()).json(),
  });
  const revenueChart = useQuery({
    queryKey: ["dashboard-revenue-chart"],
    queryFn: async () => (await api.dashboard["revenue-chart"].$get({ query: { months: "6" } })).json(),
  });
  const serviceBreakdown = useQuery({
    queryKey: ["dashboard-service-breakdown"],
    queryFn: async () => (await api.dashboard["service-breakdown"].$get()).json(),
  });
  const topClients = useQuery({
    queryKey: ["dashboard-top-clients"],
    queryFn: async () => (await api.dashboard["top-clients"].$get({ query: { limit: "5" } })).json(),
  });
  const upcomingBookings = useQuery({
    queryKey: ["dashboard-upcoming"],
    queryFn: async () => (await api.dashboard["upcoming-bookings"].$get({ query: { limit: "6" } })).json(),
  });
  const vatSummary = useQuery({
    queryKey: ["dashboard-vat", activeMonth.year, activeMonth.month],
    queryFn: async () => (await api.dashboard["vat-summary"].$get({ query: { year: String(activeMonth.year), month: String(activeMonth.month) } })).json(),
  });
  const activityFeed = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: async () => (await api.dashboard["activity-feed"].$get({ query: { limit: "10" } })).json(),
  });
  const overdue = useQuery({
    queryKey: ["overdue"],
    queryFn: async () => (await api.reminders.overdue.$get()).json(),
  });
  const stripeCommissions = useQuery({
    queryKey: ["dashboard-stripe-commissions", activeMonth.year, activeMonth.month],
    queryFn: async () => (await api.dashboard["stripe-commissions"].$get({ query: { year: String(activeMonth.year), month: String(activeMonth.month) } })).json(),
    refetchInterval: 60000,
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
          <p className="text-muted-foreground mt-1">Overview of your business</p>
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

      {/* Stat cards */}
      {stats.isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard icon={Users} label="Total clients" value={stats.data?.totalClients ?? 0} />
          <StatCard
            icon={Euro}
            label="Total revenue (net)"
            value={`€${(stats.data?.totalRevenue ?? 0).toFixed(2)}`}
          />
          <StatCard
            icon={TrendingUp}
            label="Revenue this month"
            value={`€${(stats.data?.revenueThisMonth ?? 0).toFixed(2)}`}
          />
          <StatCard icon={AlertTriangle} label="Overdue invoices" value={stats.data?.overdueCount ?? 0} tone="danger" />
          <StatCard icon={Receipt} label="Outstanding total" value={`€${(stats.data?.outstandingTotal ?? 0).toFixed(2)}`} />
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
                  formatter={(v: number) => [`€${v.toFixed(2)}`, "Revenue"]}
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
              {(vatSummary.data?.breakdown ?? []).map((b) => (
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
              {(serviceBreakdown.data?.breakdown ?? []).slice(0, 6).map((s) => (
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
              {(topClients.data?.topClients ?? []).map((tc, i) => (
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
              {(upcomingBookings.data?.upcoming ?? []).map((b) => (
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
              {(overdue.data?.overdue ?? []).slice(0, 6).map((inv) => (
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
              {(activityFeed.data?.events ?? []).map((e, i) => (
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
