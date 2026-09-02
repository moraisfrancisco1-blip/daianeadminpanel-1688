import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { StatusPill } from "../components/status-pill";
import { LineItemEditor, LineItemDraft } from "../components/line-item-editor";
import { SearchInput, SortableTh, EmptyRow, StatusFilter } from "../components/data-table";
import { useSort, cmpStr, cmpNum, cmpDate, cmpNumberLike, matchesId, applyDir, normalize, idFromQuery } from "../lib/list";
import { netToGross } from "../../api/lib/totals";
import { Plus, X, Download, Send, CheckCircle2, Loader2, Trash2, Pencil, Link2, Copy, ExternalLink, History, Ban } from "lucide-react";
import { downloadFile } from "../lib/download";

export default function InvoicesPage() {
  return (
    <Protected>
      <InvoicesContent />
    </Protected>
  );
}

const ACTION_TONE = {
  default: "border-input text-muted-foreground hover:bg-accent hover:text-foreground",
  primary: "border-brand-copper/40 text-brand-copper hover:bg-brand-copper/10",
  success: "border-[#4C7A56]/40 text-[#4C7A56] hover:bg-[#4C7A56]/10",
  purple: "border-purple-600/40 text-purple-600 hover:bg-purple-600/10",
  danger: "border-destructive/40 text-destructive hover:bg-destructive/10",
} as const;

function ActionButton({
  onClick,
  icon,
  label,
  tone = "default",
  disabled,
  title,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone?: keyof typeof ACTION_TONE;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${ACTION_TONE[tone]}`}
    >
      {icon} {label}
    </button>
  );
}

interface ClientItem {
  id: number;
  name: string;
}

interface ServiceItem {
  id: number;
  name: string;
  price: number;
  vatRate: number;
  description?: string | null;
  durationMinutes?: number;
}

interface InvoiceRow {
  id: number;
  invoiceNumber: string;
  clientName: string | null;
  clientId: number;
  clientEmail: string | null;
  status: string;
  dueDate: string;
  total: number;
  paidAt: string | null;
  reminderCount: number;
  issueDate: string;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  isTest: boolean;
  sessionDate: string | null;
  sessionStartTime: string | null;
  refundedAmount: number;
}

type InvoiceSortKey = "number" | "client" | "date" | "total" | "status";
const invoiceComparators: Record<InvoiceSortKey, (a: InvoiceRow, b: InvoiceRow) => number> = {
  number: (a, b) => cmpNumberLike(a.invoiceNumber, b.invoiceNumber),
  client: (a, b) => cmpStr(a.clientName, b.clientName),
  date: (a, b) => cmpDate(a.issueDate, b.issueDate),
  total: (a, b) => cmpNum(a.total, b.total),
  status: (a, b) => cmpStr(a.status, b.status),
};

function InvoicesContent() {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [isTest, setIsTest] = useState(false);
  const [items, setItems] = useState<LineItemDraft[]>([{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.09 }]);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { sortKey, sortDir, toggle } = useSort<InvoiceSortKey>("date", "desc");
  const [paymentLinkInvoice, setPaymentLinkInvoice] = useState<InvoiceRow | null>(null);
  const [historyInvoice, setHistoryInvoice] = useState<InvoiceRow | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }

  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  async function handleDownload(id: number, invoiceNumber: string) {
    setDownloadingId(id);
    try {
      await downloadFile(`/api/invoices/${id}/pdf`, `invoice-${invoiceNumber}.pdf`);
    } catch (e: any) {
      showToast("error", e?.message ?? "Failed to download PDF");
    } finally {
      setDownloadingId(null);
    }
  }

  async function requestPaymentLink(inv: InvoiceRow) {
    setPaymentLinkInvoice(inv);
    setCheckoutUrl(null);
    setCheckoutLoading(true);
    try {
      const res = await api.invoices[":id"].checkout.$post({ param: { id: String(inv.id) } });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to create payment link");
      setCheckoutUrl((data as { checkoutUrl?: string })?.checkoutUrl ?? null);
    } catch (e: any) {
      showToast("error", e?.message ?? "Failed to create payment link");
      setPaymentLinkInvoice(null);
    } finally {
      setCheckoutLoading(false);
    }
  }

  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const res = await api.invoices.$get();
      const data = await res.json();
      return data as { invoices: InvoiceRow[] };
    },
  });

  const { data: clientsData } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const res = await api.clients.$get();
      const data = await res.json();
      return data as { clients: ClientItem[] };
    },
  });

  const { data: servicesData } = useQuery({
    queryKey: ["services"],
    queryFn: async () => {
      const res = await api.services.$get();
      const data = await res.json();
      return data as { services: ServiceItem[] };
    },
  });

  const createInvoice = useMutation({
    mutationFn: async () => {
      const res = await api.invoices.$post({ json: { clientId, items, isTest } });
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setShowForm(false);
      resetForm();
    },
  });

  const updateInvoice = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/invoices/${editId}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          invoiceNumber: invoiceNumber || undefined,
          items,
          status: undefined, // keep existing
        }),
      });
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setShowForm(false);
      setEditId(null);
      resetForm();
      showToast("success", "Invoice updated.");
    },
    onError: () => showToast("error", "Failed to update invoice."),
  });

  const markPaid = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/invoices/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid" }),
      });
      return await res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });

  const sendInvoice = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.invoices[":id"].send.$post({ param: { id: String(id) } });
      const data = await res.json();
      if (!res.ok) throw new Error((data as any)?.message ?? "Failed to send email");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      showToast("success", "Invoice emailed to client.");
    },
    onError: (err: any) => {
      showToast("error", err?.message ?? "Failed to send email — check client has an email address.");
    },
  });

  const sendPaymentLink = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.invoices[":id"]["send-payment-link"].$post({ param: { id: String(id) } });
      const data = await res.json();
      if (!res.ok) throw new Error((data as any)?.message ?? "Failed to send payment link");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      showToast("success", "Payment link emailed to client.");
    },
    onError: (err: any) => {
      showToast("error", err?.message ?? "Failed to send payment link.");
    },
  });


  const deleteInvoice = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.invoices[":id"].$delete({ param: { id: String(id) } });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to delete invoice.");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      showToast("success", "Invoice deleted.");
    },
    onError: (err: any) => showToast("error", err?.message ?? "Failed to delete invoice."),
  });

  const cancelInvoice = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/invoices/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to cancel invoice.");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      showToast("success", "Invoice cancelled.");
    },
    onError: (err: any) => showToast("error", err?.message ?? "Failed to cancel invoice."),
  });

  function handleCancel(id: number, invoiceNumber: string) {
    if (window.confirm(`Cancel invoice ${invoiceNumber}? It keeps its number for the record but no longer counts as revenue.`)) {
      cancelInvoice.mutate(id);
    }
  }

  function handleDelete(id: number, invoiceNumber: string) {
    if (window.confirm(`Delete invoice ${invoiceNumber}? This cannot be undone.`)) {
      deleteInvoice.mutate(id);
    }
  }

  function resetForm() {
    setClientId(null);
    setInvoiceNumber("");
    setIsTest(false);
    setItems([{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.09 }]);
  }

  function openNewForm() {
    setEditId(null);
    resetForm();
    setShowForm(true);
  }

  async function openEditForm(inv: InvoiceRow) {
    try {
      const res = await fetch(`/api/invoices/${inv.id}`);
      const data = await res.json();
      if (!res.ok) return;
      setEditId(inv.id);
      setClientId(data.invoice.clientId);
      setInvoiceNumber(data.invoice.invoiceNumber);
      setItems(
        (data.items ?? []).map((i: any) => ({
          description: i.description,
          serviceId: i.serviceId ?? null,
          quantity: i.quantity,
          unitPrice: netToGross(i.unitPrice, i.vatRate),
          vatRate: i.vatRate,
        })),
      );
      setShowForm(true);
    } catch {
      showToast("error", "Failed to load invoice details.");
    }
  }

  function handleSubmit() {
    if (editId !== null) {
      updateInvoice.mutate();
    } else {
      createInvoice.mutate();
    }
  }

  const isEditing = editId !== null;
  const invoices = invoicesData?.invoices ?? [];
  const clients = clientsData?.clients ?? [];
  const services = servicesData?.services ?? [];

  const q = normalize(search);
  const exactId = idFromQuery(search);
  const filtered = invoices.filter((inv) => {
    if (statusFilter !== "all" && inv.status !== statusFilter) return false;
    if (!q) return true;
    if (matchesId(inv.id, search)) return true;
    return normalize([inv.invoiceNumber, inv.clientName, inv.clientEmail, inv.stripePaymentIntentId].filter(Boolean).join(" ")).includes(q);
  });
  const sorted = [...filtered].sort((a, b) => applyDir(invoiceComparators[sortKey](a, b), sortDir));

  return (
    <div className="space-y-6">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-md text-sm font-medium ${
            toast.type === "success" ? "bg-[#4C7A56] text-white" : "bg-destructive text-white"
          }`}
        >
          {toast.message}
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Invoices</h1>
          <p className="text-muted-foreground mt-1">{invoices.length} invoices</p>
        </div>
        <Button onClick={openNewForm}>
          <Plus className="size-4" /> New invoice
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by number, client, email, ID or PaymentIntent…" />
        <StatusFilter
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All" },
            { value: "draft", label: "Draft" },
            { value: "sent", label: "Sent" },
            { value: "paid", label: "Paid" },
            { value: "overdue", label: "Overdue" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </div>

      {invoicesLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <SortableTh label="Invoice #" active={sortKey === "number"} dir={sortDir} onClick={() => toggle("number")} />
                <SortableTh label="Client" active={sortKey === "client"} dir={sortDir} onClick={() => toggle("client")} />
                <SortableTh label="Date" active={sortKey === "date"} dir={sortDir} onClick={() => toggle("date")} />
                <th className="px-4 py-3 font-medium">Session</th>
                <SortableTh label="Total" active={sortKey === "total"} dir={sortDir} onClick={() => toggle("total")} />
                <SortableTh label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggle("status")} />
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((inv) => {
                const isExact = exactId !== null && inv.id === exactId;
                return (
                <tr key={inv.id} className={`border-t border-border hover:bg-accent/40 transition-colors ${isExact ? "bg-primary/10" : ""}`}>
                  <td className="px-4 py-3 font-medium">
                    {inv.invoiceNumber}
                    {inv.isTest && (
                      <span className="ml-2 inline-block text-[10px] bg-amber-500 text-white rounded px-1 align-middle">TEST</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{inv.clientName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(inv.issueDate).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {inv.sessionDate
                      ? (() => {
                          const d = new Date(`${inv.sessionDate}T00:00:00`);
                          const day = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                          return inv.sessionStartTime ? `${day} · ${inv.sessionStartTime}` : day;
                        })()
                      : <span className="italic opacity-70">No session</span>}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    €{inv.total.toFixed(2)}
                    {inv.refundedAmount > 0 && (
                      <p className="text-xs font-normal text-purple-600">-€{inv.refundedAmount.toFixed(2)} refunded</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={inv.refundedAmount > 0 ? (inv.refundedAmount >= inv.total ? "refunded" : "partially_refunded") : inv.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-1.5 max-w-[420px] ml-auto">
                      <ActionButton
                        onClick={() => setHistoryInvoice(inv)}
                        icon={<History className="size-3.5" />}
                        label="Histórico"
                        tone="primary"
                        title="O que aconteceu com esta fatura — quando foi enviada, paga, etc."
                      />
                      <ActionButton
                        onClick={() => sendInvoice.mutate(inv.id)}
                        disabled={sendInvoice.isPending && sendInvoice.variables === inv.id}
                        icon={sendInvoice.isPending && sendInvoice.variables === inv.id ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                        label="Enviar"
                        title="Enviar a fatura por email ao cliente"
                      />
                      {inv.status !== "paid" && (
                        <ActionButton
                          onClick={() => requestPaymentLink(inv)}
                          disabled={checkoutLoading && paymentLinkInvoice?.id === inv.id}
                          icon={checkoutLoading && paymentLinkInvoice?.id === inv.id ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
                          label="Link de pagamento"
                          title="Gerar/enviar um link de pagamento Stripe"
                        />
                      )}
                      {inv.status !== "paid" && (
                        <ActionButton
                          onClick={() => markPaid.mutate(inv.id)}
                          icon={<CheckCircle2 className="size-3.5" />}
                          label="Marcar paga"
                          tone="success"
                          title="Marcar como paga manualmente (ex: dinheiro, transferência)"
                        />
                      )}
                      <ActionButton
                        onClick={() => handleDownload(inv.id, inv.invoiceNumber)}
                        disabled={downloadingId === inv.id}
                        icon={downloadingId === inv.id ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                        label="PDF"
                        title="Descarregar o PDF da fatura"
                      />
                      <ActionButton
                        onClick={() => openEditForm(inv)}
                        icon={<Pencil className="size-3.5" />}
                        label="Editar"
                        title="Editar os itens da fatura"
                      />
                      {inv.status !== "paid" && inv.status !== "cancelled" && (
                        <ActionButton
                          onClick={() => handleCancel(inv.id, inv.invoiceNumber)}
                          disabled={cancelInvoice.isPending && cancelInvoice.variables === inv.id}
                          icon={<Ban className="size-3.5" />}
                          label="Cancelar"
                          tone="purple"
                          title="Cancelar (mantém o número para o contabilista, deixa de contar como receita)"
                        />
                      )}
                      {inv.status === "draft" && (
                        <ActionButton
                          onClick={() => handleDelete(inv.id, inv.invoiceNumber)}
                          disabled={deleteInvoice.isPending && deleteInvoice.variables === inv.id}
                          icon={deleteInvoice.isPending && deleteInvoice.variables === inv.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                          label="Apagar"
                          tone="danger"
                          title="Apagar rascunho (só possível antes de ser enviado)"
                        />
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
              {sorted.length === 0 && <EmptyRow colSpan={7} searching={q.length > 0} noun="invoices" />}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl p-6 w-full max-w-2xl space-y-4 relative">
            <button onClick={() => { setShowForm(false); setEditId(null); resetForm(); }} className="absolute top-4 right-4 text-muted-foreground">
              <X className="size-4" />
            </button>
            <h2 className="font-display text-xl font-semibold">
              {isEditing ? "Edit invoice" : "New invoice"}
            </h2>
            
            <input
              type="text"
              placeholder="Invoice number (e.g. 2026-0141)"
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
            />
            
            <select
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              value={clientId ?? ""}
              onChange={(e) => setClientId(Number(e.target.value))}
            >
              <option value="">Select client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isTest}
                onChange={(e) => setIsTest(e.target.checked)}
              />
              Test invoice (uses TEST- numbering, does not consume official numbering)
            </label>
            <LineItemEditor items={items} onChange={setItems} services={services} />
            <Button
              className="w-full"
              disabled={!clientId || createInvoice.isPending || updateInvoice.isPending}
              onClick={handleSubmit}
            >
              {createInvoice.isPending || updateInvoice.isPending
                ? "Saving…"
                : isEditing
                  ? "Update invoice"
                  : "Create invoice"}
            </Button>
          </div>
        </div>
      )}

      {paymentLinkInvoice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl p-6 w-full max-w-md space-y-4 relative">
            <button onClick={() => setPaymentLinkInvoice(null)} className="absolute top-4 right-4 text-muted-foreground">
              <X className="size-4" />
            </button>
            <h2 className="font-display text-xl font-semibold">Send Payment Link</h2>
            <p className="text-sm text-muted-foreground">
              Invoice <strong>{paymentLinkInvoice.invoiceNumber}</strong> — €{paymentLinkInvoice.total.toFixed(2)}
            </p>

            {checkoutLoading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Creating payment link…
              </div>
            ) : checkoutUrl ? (
              <div className="space-y-2">
                <input
                  readOnly
                  value={checkoutUrl}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => navigator.clipboard?.writeText(checkoutUrl).then(() => showToast("success", "Payment link copied."))}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent"
                  >
                    <Copy className="size-4" /> Copy link
                  </button>
                  <button
                    onClick={() => window.open(checkoutUrl, "_blank")}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent"
                  >
                    <ExternalLink className="size-4" /> Open link
                  </button>
                </div>
                <button
                  onClick={() => { sendPaymentLink.mutate(paymentLinkInvoice.id); setPaymentLinkInvoice(null); }}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:opacity-90"
                >
                  <Send className="size-4" /> Send via email
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Could not create a payment link.</p>
            )}
          </div>
        </div>
      )}

      {historyInvoice && <InvoiceHistoryModal invoice={historyInvoice} onClose={() => setHistoryInvoice(null)} />}

    </div>
  );
}

function InvoiceHistoryModal({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["invoice", "history", invoice.id],
    queryFn: async () => {
      const res = await fetch(`/api/invoices/${invoice.id}`);
      const data = await res.json();
      return data as { invoice: any; activity: any[]; emails: any[]; payments: any[]; refunds: any[] };
    },
  });

  const activity: any[] = detail.data?.activity ?? [];
  const emails: any[] = detail.data?.emails ?? [];
  const refunds: any[] = detail.data?.refunds ?? [];

  const EMAIL_TYPE_LABEL: Record<string, string> = {
    invoice: "fatura",
    payment_link: "link de pagamento",
    booking_confirmation: "confirmação de marcação",
    reminder: "lembrete",
    cancellation: "cancelamento",
    quote: "orçamento",
    package: "pacote",
    other: "email",
  };

  type Entry = { ts: number; icon: string; label: string; detail: string; tone?: string };
  const entries: Entry[] = [
    ...activity.map((a): Entry => {
      const labels: Record<string, { icon: string; label: string }> = {
        created: { icon: "📝", label: "Fatura criada" },
        edited: { icon: "✏️", label: "Fatura editada" },
        sent: { icon: "📨", label: "Marcada como enviada" },
        payment_link_created: { icon: "🔗", label: "Link de pagamento criado" },
        payment_link_sent: { icon: "🔗", label: "Link de pagamento enviado" },
        status_changed: { icon: "🔄", label: "Estado alterado" },
        payment_recorded: { icon: "💶", label: "Pagamento registado" },
        payment_confirmed: { icon: "✅", label: "Pagamento confirmado pelo Stripe" },
        refunded: { icon: "↩️", label: "Reembolso" },
        email_failed: { icon: "⚠️", label: "Falha ao enviar email" },
        cancelled: { icon: "🚫", label: "Fatura cancelada" },
      };
      const meta = labels[a.type] ?? { icon: "•", label: a.type };
      const STATUS_PT: Record<string, string> = { draft: "rascunho", sent: "enviada", paid: "paga", cancelled: "cancelada", overdue: "vencida" };
      let detailText = "";
      if (a.type === "status_changed" && a.oldStatus && a.newStatus) {
        detailText = `${STATUS_PT[a.oldStatus] ?? a.oldStatus} → ${STATUS_PT[a.newStatus] ?? a.newStatus}`;
      } else if (a.type === "payment_confirmed" || a.type === "payment_recorded" || a.type === "refunded") {
        detailText = `€${(a.amount ?? 0).toFixed(2)}${a.method ? ` · ${a.method}` : ""}`;
      }
      return { ts: new Date(a.createdAt).getTime(), icon: meta.icon, label: meta.label, detail: detailText };
    }),
    ...emails.map(
      (e): Entry => ({
        ts: new Date(e.createdAt).getTime(),
        icon: e.status === "failed" ? "⚠️" : "📧",
        label: e.status === "failed" ? "Email não foi enviado" : "Email enviado de verdade",
        detail: `${EMAIL_TYPE_LABEL[e.type] ?? e.type} · para ${e.recipientEmail}${e.status === "failed" && e.error ? ` — ${e.error}` : ""}`,
        tone: e.status === "failed" ? "text-destructive" : "text-[#4C7A56]",
      }),
    ),
    ...refunds.map(
      (r): Entry => ({
        ts: new Date(r.createdAt).getTime(),
        icon: "↩️",
        label: r.status === "succeeded" ? "Reembolso feito" : `Reembolso (${r.status})`,
        detail: `€${r.amount.toFixed(2)}${r.reason ? ` · ${r.reason}` : ""}`,
        tone: "text-purple-600",
      }),
    ),
  ];
  // Oldest first — reads top to bottom like the actual story of the invoice.
  entries.sort((a, b) => a.ts - b.ts);

  const refundedAmount = refunds.filter((r) => r.status === "succeeded").reduce((s, r) => s + r.amount, 0);
  const effectiveStatus =
    refundedAmount > 0 ? (refundedAmount >= invoice.total ? "refunded" : "partially_refunded") : invoice.status;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl p-6 w-full max-w-lg space-y-4 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground">
          <X className="size-4" />
        </button>
        <h2 className="font-display text-xl font-semibold">Fatura {invoice.invoiceNumber}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill status={effectiveStatus} />
          <span className="text-sm text-muted-foreground">€{invoice.total.toFixed(2)}</span>
        </div>
        {detail.isLoading ? (
          <div className="py-8 text-center">
            <Loader2 className="size-5 animate-spin mx-auto" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">Ainda não aconteceu nada com esta fatura.</p>
        ) : (
          <ol className="space-y-3 border-l-2 border-border pl-4">
            {entries.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[25px] top-0 text-base leading-none">{e.icon}</span>
                <p className="text-xs text-muted-foreground">{new Date(e.ts).toLocaleString("pt-PT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                <p className="font-medium">{e.label}</p>
                {e.detail && <p className={`text-sm ${e.tone ?? "text-muted-foreground"}`}>{e.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
