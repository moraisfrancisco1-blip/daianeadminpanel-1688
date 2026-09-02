import { useQuery } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Link } from "wouter";
import { Undo2 } from "lucide-react";

type RefundRow = {
  id: number;
  invoiceId: number;
  paymentId: number;
  amount: number;
  reason: string | null;
  status: string;
  stripeRefundId: string | null;
  createdAt: string;
  invoiceNumber: string | null;
  invoiceTotal: number | null;
  clientId: number | null;
  clientName: string | null;
  clientEmail: string | null;
  paymentMethod: string | null;
  paymentPaidAt: string | null;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  succeeded: { label: "Refunded", cls: "bg-purple-600 text-white" },
  pending: { label: "Pending", cls: "bg-amber-500 text-white" },
  failed: { label: "Failed", cls: "bg-red-600 text-white" },
  canceled: { label: "Canceled", cls: "bg-neutral-400 text-white" },
};

const REASON_LABEL: Record<string, string> = {
  duplicate: "Duplicate charge",
  fraudulent: "Fraudulent",
  requested_by_customer: "Requested by client",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function RefundsPage() {
  return (
    <Protected>
      <RefundsContent />
    </Protected>
  );
}

function RefundsContent() {
  const query = useQuery({
    queryKey: ["refunds"],
    queryFn: async () => {
      const res = await api.refunds.$get();
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to load");
      return data as { refunds: RefundRow[]; summary: { count: number; succeededCount: number; totalRefunded: number } };
    },
  });

  const rows = query.data?.refunds ?? [];
  const summary = query.data?.summary;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
          <Undo2 className="size-7 text-brand-copper" /> Refunds
        </h1>
        <p className="text-muted-foreground mt-1">Recorded automatically from Stripe when a payment is refunded</p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-4 max-w-md">
          <div className="bg-card border-2 border-purple-600/40 rounded-xl p-4">
            <p className="text-xs text-muted-foreground">TOTAL REFUNDED</p>
            <p className="font-display text-2xl font-semibold mt-1">€{summary.totalRefunded.toFixed(2)}</p>
            <p className="text-sm text-muted-foreground">{summary.succeededCount} refund{summary.succeededCount === 1 ? "" : "s"}</p>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading…</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No refunds recorded.</td>
                </tr>
              ) : (
                rows.map((r) => {
                  const meta = STATUS_META[r.status] ?? { label: r.status, cls: "bg-neutral-400 text-white" };
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-accent/40 transition-colors align-top">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.clientId ? (
                          <Link to={`/clients/${r.clientId}`} className="font-medium hover:underline">
                            {r.clientName ?? "—"}
                          </Link>
                        ) : (
                          <p className="font-medium">{r.clientName ?? "—"}</p>
                        )}
                        <p className="text-xs text-muted-foreground">{r.clientEmail ?? ""}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.invoiceNumber ?? "—"}
                        {r.invoiceTotal != null && <p className="text-xs">of €{r.invoiceTotal.toFixed(2)}</p>}
                      </td>
                      <td className="px-4 py-3 font-medium text-purple-600">-€{r.amount.toFixed(2)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.reason ? (REASON_LABEL[r.reason] ?? r.reason) : "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.paymentMethod ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(r.createdAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
