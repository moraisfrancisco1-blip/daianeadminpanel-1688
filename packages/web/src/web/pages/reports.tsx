import { useQuery } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Download } from "lucide-react";

type Monthly = { month: string; label: string; billed: number; paid: number; pending: number; sessions: number };
type TopService = { name: string; revenue: number; count: number };

export default function ReportsPage() {
  return (
    <Protected>
      <ReportsContent />
    </Protected>
  );
}

function ReportsContent() {
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

  function exportCsv() {
    if (!q.data) return;
    const rows: string[][] = [
      ["Mês", "Faturado", "Recebido", "Pendente", "Sessões"],
      ...q.data.monthly.map((m) => [m.month, m.billed.toFixed(2), m.paid.toFixed(2), m.pending.toFixed(2), String(m.sessions)]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "relatorio-financeiro.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (q.isLoading) return <div className="h-96 rounded-xl bg-muted animate-pulse" />;

  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-brand-teal">Relatórios</h1>
          <p className="text-muted-foreground mt-1">Últimos 12 meses</p>
        </div>
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90"
        >
          <Download className="size-4" /> Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatBox label="Faturado (12m)" value={`€${(d?.monthly.reduce((s, m) => s + m.billed, 0) ?? 0).toFixed(2)}`} />
        <StatBox label="Recebido (12m)" value={`€${(d?.monthly.reduce((s, m) => s + m.paid, 0) ?? 0).toFixed(2)}`} tone="green" />
        <StatBox label="Clientes (total)" value={String(d?.totalClients ?? 0)} />
        <StatBox label="Novos clientes (mês)" value={String(d?.newClientsThisMonth ?? 0)} />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <h3 className="font-medium p-6 pb-3">Faturação mensal</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Mês</th>
                <th className="px-4 py-3 font-medium">Faturado</th>
                <th className="px-4 py-3 font-medium">Recebido</th>
                <th className="px-4 py-3 font-medium">Pendente</th>
                <th className="px-4 py-3 font-medium">Sessões</th>
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
          <h3 className="font-medium mb-4">Serviços mais faturados</h3>
          <div className="space-y-3">
            {(d?.topServices ?? []).map((s) => (
              <div key={s.name} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.count} unidades</p>
                </div>
                <span className="font-medium text-brand-copper">€{s.revenue.toFixed(2)}</span>
              </div>
            ))}
            {(d?.topServices ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sem dados.</p>}
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4">Pagamentos pendentes</h3>
          <p className="text-3xl font-display font-semibold text-brand-copper">{d?.pendingCount ?? 0}</p>
          <p className="text-sm text-muted-foreground mt-1">
            faturas em aberto · €{(d?.pendingTotal ?? 0).toFixed(2)}
          </p>
        </div>
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
