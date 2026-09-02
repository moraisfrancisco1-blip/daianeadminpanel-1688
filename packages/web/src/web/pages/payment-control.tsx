import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";

type PayRow = {
  invoiceId: number;
  invoiceNumber: string;
  clientId: number | null;
  clientName: string | null;
  clientEmail: string | null;
  total: number;
  status: string;
  paidAt: string | null;
  sessionDate: string | null;
  sessionStartTime: string | null;
  stripeCheckoutStatus: string | null;
  stripePaymentIntentStatus: string | null;
  lastStripeVerifiedAt: string | null;
  hasPayment: boolean;
  paymentMethod: string | null;
  state: string;
  problem: string | null;
  verified: boolean;
};

const STATE_META: Record<string, { label: string; cls: string; dot: string }> = {
  confirmed: { label: "PAID", cls: "bg-[#4C7A56] text-white", dot: "🟢" },
  awaiting: { label: "AWAITING PAYMENT", cls: "bg-amber-500 text-white", dot: "🟡" },
  processing: { label: "PROCESSING", cls: "bg-sky-600 text-white", dot: "🔵" },
  attention: { label: "ATTENTION REQUIRED", cls: "bg-red-600 text-white", dot: "🔴" },
  cancelled: { label: "CANCELLED", cls: "bg-neutral-400 text-white", dot: "⚪" },
  unknown: { label: "NEEDS VERIFICATION", cls: "bg-neutral-400 text-white", dot: "⚪" },
};

const PROBLEM_LABEL: Record<string, string> = {
  expired_link: "Payment link expired — needs a new link",
  payment_failed: "Payment attempt failed",
  stripe_paid_but_invoice_not_paid: "Paid in Stripe but invoice not updated",
  paid_but_no_payment_record: "Marked paid but no payment record",
  paid_but_no_paid_at: "Marked paid but payment date missing",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function PaymentControlPage() {
  return (
    <Protected>
      <PaymentControlContent />
    </Protected>
  );
}

function PaymentControlContent() {
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["payment-control"],
    queryFn: async () => {
      const res = await api["payment-control"].$get();
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to load");
      return data as { summary: any; payments: PayRow[] };
    },
  });

  const verify = useMutation({
    mutationFn: async () => (await api["payment-control"].verify.$post()).json(),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["payment-control"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setToast(`Verify done: ${d.checked} checked, ${d.fixed} fixed.`);
      setTimeout(() => setToast(null), 5000);
    },
    onError: (e: any) => {
      setToast(`Verify failed: ${e?.message ?? "error"}`);
      setTimeout(() => setToast(null), 5000);
    },
  });

  const summary = query.data?.summary;
  const rows = query.data?.payments ?? [];

  const cards = [
    { key: "paidCount", label: "PAID", val: summary?.paidTotal ?? 0, n: summary?.paidCount ?? 0, cls: "border-[#4C7A56]/40" },
    { key: "awaiting", label: "AWAITING PAYMENT", val: summary?.awaitingTotal ?? 0, n: summary?.awaitingCount ?? 0, cls: "border-amber-500/40" },
    { key: "processing", label: "PROCESSING", val: summary?.processingTotal ?? 0, n: summary?.processingCount ?? 0, cls: "border-sky-600/40" },
    { key: "attention", label: "ATTENTION REQUIRED", val: summary?.attentionTotal ?? 0, n: summary?.attentionCount ?? 0, cls: "border-red-600/40" },
  ];

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-md text-sm font-medium bg-[#4C7A56] text-white">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Payment Control</h1>
          <p className="text-muted-foreground mt-1">Operational source of truth for payments</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            {summary?.stripeConfigured ? <ShieldCheck className="size-4 text-[#4C7A56]" /> : <ShieldAlert className="size-4 text-red-600" />}
            {summary?.stripeConfigured ? "Stripe connected" : "Stripe not configured"}
          </span>
          <button
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
          >
            {verify.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Verify payments
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {cards.map((cd) => (
            <div key={cd.key} className={`bg-card border-2 ${cd.cls} rounded-xl p-4`}>
              <p className="text-xs text-muted-foreground">{cd.label}</p>
              <p className="font-display text-2xl font-semibold mt-1">€{cd.val.toFixed(2)}</p>
              <p className="text-sm text-muted-foreground">{cd.n} invoice{cd.n === 1 ? "" : "s"}</p>
            </div>
          ))}
        </div>
      )}
      {summary && (
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>Outstanding total: <strong className="text-foreground">€{(summary.outstandingTotal ?? 0).toFixed(2)}</strong></span>
          <span>Unknown / needs verification: <strong className="text-foreground">{summary.unknownCount ?? 0}</strong></span>
          <span>Cancelled: <strong className="text-foreground">{summary.cancelledCount ?? 0}</strong></span>
        </div>
      )}


      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Value</th>
                <th className="px-4 py-3 font-medium">Session</th>
                <th className="px-4 py-3 font-medium">Stripe</th>
                <th className="px-4 py-3 font-medium">Verified</th>
                <th className="px-4 py-3 font-medium">Payment date</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Problem / Action</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center">
                    <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">No invoices.</td>
                </tr>
              ) : (
                rows.map((r) => {
                  const meta = STATE_META[r.state] ?? STATE_META.unknown;
                  return (
                    <tr key={r.invoiceId} className="border-t border-border hover:bg-accent/40 transition-colors align-top">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.cls}`}>
                          <span>{meta.dot}</span> {meta.label}
                        </span>
                        {!r.verified && r.state !== "confirmed" && (
                          <p className="text-[10px] text-muted-foreground mt-1">Needs Stripe verification</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{r.clientName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{r.clientEmail ?? ""}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.invoiceNumber}</td>
                      <td className="px-4 py-3 font-medium">€{r.total.toFixed(2)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.sessionDate ? `${r.sessionDate.slice(8, 10)} ${new Date(r.sessionDate + "T00:00:00").toLocaleString("en-GB", { month: "short" })}${r.sessionStartTime ? " " + r.sessionStartTime : ""}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.stripePaymentIntentStatus ?? r.stripeCheckoutStatus ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.lastStripeVerifiedAt ? fmtDate(r.lastStripeVerifiedAt) : "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.paidAt ? fmtDate(r.paidAt) : "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.paymentMethod ?? "—"}</td>
                      <td className="px-4 py-3">
                        {r.problem ? (
                          <span className="text-xs text-red-600 inline-flex items-center gap-1"><AlertTriangle className="size-3.5" /> {PROBLEM_LABEL[r.problem] ?? r.problem}</span>
                        ) : r.state === "awaiting" ? (
                          <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Clock className="size-3.5" /> Awaiting payment</span>
                        ) : r.state === "confirmed" ? (
                          <span className="text-xs text-[#4C7A56] inline-flex items-center gap-1"><CheckCircle2 className="size-3.5" /> Payment confirmed</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
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

