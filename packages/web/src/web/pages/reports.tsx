import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Download } from "lucide-react";

type Monthly = { month: string; label: string; billed: number; paid: number; pending: number; sessions: number };
type TopService = { name: string; revenue: number; count: number };
type VatQuarterly = {
  year: number;
  quarter: number;
  label: string;
  invoiceCount: number;
  breakdown: { rate: number; base: number; vat: number }[];
  totalNet: number;
  totalVat: number;
  totalGross: number;
  expenseCount: number;
  expenseBreakdown: { rate: number; base: number; vat: number }[];
  expensesNet: number;
  expensesVat: number;
  vatPayable: number;
};

export default function ReportsPage() {
  return (
    <Protected>
      <ReportsContent />
    </Protected>
  );
}

function ReportsContent() {
  const now = new Date();
  const [vatYear, setVatYear] = useState(now.getFullYear());
  const [vatQuarter, setVatQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);

  const q = useQuery({
    queryKey: ["reports-overview"],
    queryFn: async (): Promise<{
      monthly: Monthly[];
      topServices: TopService[];
      totalClients: number;
      newClientsThisMonth: number;
      pendingCount: number;
      pendingTotal: number;
    }> => {
      const res = await api.reports.overview.$get();
      return (await res.json()) as any;
    },
  });

  const vatQ = useQuery({
    queryKey: ["reports-vat-quarterly", vatYear, vatQuarter],
    queryFn: async (): Promise<VatQuarterly> => {
      const res = await api.reports["vat-quarterly"].$get({ query: { year: String(vatYear), quarter: String(vatQuarter) } } as any);
      return (await res.json()) as any;
    },
  });

  function exportCsv() {
    if (!q.data) return;
    const rows: string[][] = [
      ["Month", "Billed", "Received", "Pending", "Sessions"],
      ...q.data.monthly.map((m) => [m.month, m.billed.toFixed(2), m.paid.toFixed(2), m.pending.toFixed(2), String(m.sessions)]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "financial-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (q.isLoading) return <div className="h-96 rounded-xl bg-muted animate-pulse" />;

  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-brand-teal">Reports</h1>
          <p className="text-muted-foreground mt-1">Last 12 months</p>
        </div>
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90"
        >
          <Download className="size-4" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBox label="Billed (12m)" value={`€${(d?.monthly.reduce((s, m) => s + m.billed, 0) ?? 0).toFixed(2)}`} />
        <StatBox label="Received (12m)" value={`€${(d?.monthly.reduce((s, m) => s + m.paid, 0) ?? 0).toFixed(2)}`} tone="green" />
        <StatBox label="Clients (total)" value={String(d?.totalClients ?? 0)} />
        <StatBox label="New clients (month)" value={String(d?.newClientsThisMonth ?? 0)} />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <h3 className="font-medium p-6 pb-3">Monthly billing</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Month</th>
                <th className="px-4 py-3 font-medium">Billed</th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Pending</th>
                <th className="px-4 py-3 font-medium">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {(d?.monthly ?? []).map((m) => (
                <tr key={m.month} className="border-t border-border">
                  <td className="px-6 py-3 font-medium">{m.label}</td>
                  <td className="px-4 py-3">€{m.billed.toFixed(2)}</td>
                  <td className="px-4 py-3 text-[#4C7A56]">€{m.paid.toFixed(2)}</td>
                  <td className="px-4 py-3 text-brand-copper">€{m.pending.toFixed(2)}</td>
                  <td className="px-4 py-3">{m.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4">Top billed services</h3>
          <div className="space-y-3">
            {(d?.topServices ?? []).map((s) => (
              <div key={s.name} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.count} units</p>
                </div>
                <span className="font-medium text-brand-copper">€{s.revenue.toFixed(2)}</span>
              </div>
            ))}
            {(d?.topServices ?? []).length === 0 && <p className="text-sm text-muted-foreground">No data.</p>}
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4">Pending payments</h3>
          <p className="text-3xl font-display font-semibold text-brand-copper">{d?.pendingCount ?? 0}</p>
          <p className="text-sm text-muted-foreground mt-1">
            open invoices · €{(d?.pendingTotal ?? 0).toFixed(2)}
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h3 className="font-medium">VAT (BTW) due — quarterly</h3>
          <div className="flex items-center gap-2">
            <select
              className="h-9 px-2 rounded-md border border-input bg-background text-sm"
              value={vatQuarter}
              onChange={(e) => setVatQuarter(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((qtr) => (
                <option key={qtr} value={qtr}>
                  Q{qtr}
                </option>
              ))}
            </select>
            <input
              type="number"
              className="h-9 w-24 px-2 rounded-md border border-input bg-background text-sm"
              value={vatYear}
              onChange={(e) => setVatYear(Number(e.target.value))}
            />
          </div>
        </div>
        {vatQ.isLoading ? (
          <div className="h-24 rounded-lg bg-muted animate-pulse" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">VAT rate</th>
                    <th className="py-2 pr-4 font-medium">Net base</th>
                    <th className="py-2 pr-4 font-medium">VAT collected</th>
                  </tr>
                </thead>
                <tbody>
                  {(vatQ.data?.breakdown ?? []).map((b) => (
                    <tr key={b.rate} className="border-t border-border">
                      <td className="py-2 pr-4 font-medium">{(b.rate * 100).toFixed(0)}%</td>
                      <td className="py-2 pr-4">€{b.base.toFixed(2)}</td>
                      <td className="py-2 pr-4">€{b.vat.toFixed(2)}</td>
                    </tr>
                  ))}
                  {(vatQ.data?.breakdown ?? []).length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-muted-foreground">
                        No invoices this quarter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-6 mt-4 pt-4 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground">Net revenue</p>
                <p className="text-lg font-display font-semibold">€{(vatQ.data?.totalNet ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">VAT collected</p>
                <p className="text-lg font-display font-semibold">€{(vatQ.data?.totalVat ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Gross total</p>
                <p className="text-lg font-display font-semibold">€{(vatQ.data?.totalGross ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Invoices counted</p>
                <p className="text-lg font-display font-semibold">{vatQ.data?.invoiceCount ?? 0}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-6 mt-4 pt-4 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground">Expenses (net)</p>
                <p className="text-lg font-display font-semibold">€{(vatQ.data?.expensesNet ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">VAT paid (deductible)</p>
                <p className="text-lg font-display font-semibold">€{(vatQ.data?.expensesVat ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expenses counted</p>
                <p className="text-lg font-display font-semibold">{vatQ.data?.expenseCount ?? 0}</p>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">Net VAT payable (collected − deductible)</p>
              <p className="text-2xl font-display font-semibold text-brand-copper">€{(vatQ.data?.vatPayable ?? 0).toFixed(2)}</p>
            </div>

            <p className="text-xs text-muted-foreground mt-3">
              Based on invoices issued in this quarter (excluding drafts and cancelled invoices) and expenses logged with a date in this
              quarter — matches the figures on the BTW aangifte. Add expense receipts on the{" "}
              <a href="/expenses" className="text-brand-teal underline">
                Expenses
              </a>{" "}
              page.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-display font-semibold ${tone === "green" ? "text-[#4C7A56]" : ""}`}>{value}</p>
    </div>
  );
}
