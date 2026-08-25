import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { StatusPill } from "../components/status-pill";
import { LineItemEditor, LineItemDraft } from "../components/line-item-editor";
import { SearchInput, SortableTh, EmptyRow } from "../components/data-table";
import { useSort, cmpStr, cmpNum, cmpDate, cmpNumberLike, matchesId, applyDir, normalize, idFromQuery } from "../lib/list";
import { netToGross } from "../../api/lib/totals";
import { Plus, X, Download, Send, CheckCircle2, Loader2, Trash2, Pencil, Link2, Copy, ExternalLink } from "lucide-react";
import { downloadFile } from "../lib/download";

export default function InvoicesPage() {
  return (
    <Protected>
      <InvoicesContent />
    </Protected>
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
  const [items, setItems] = useState<LineItemDraft[]>([{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.09 }]);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const { sortKey, sortDir, toggle } = useSort<InvoiceSortKey>("date", "desc");
  const [paymentLinkInvoice, setPaymentLinkInvoice] = useState<InvoiceRow | null>(null);
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
      const res = await api.invoices.$post({ json: { clientId, items } });
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

  const deleteInvoice = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.invoices[":id"].$delete({ param: { id: String(id) } });
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      showToast("success", "Invoice deleted.");
    },
    onError: () => showToast("error", "Failed to delete invoice."),
  });

  function handleDelete(id: number, invoiceNumber: string) {
    if (window.confirm(`Delete invoice ${invoiceNumber}? This cannot be undone.`)) {
      deleteInvoice.mutate(id);
    }
  }

  function resetForm() {
    setClientId(null);
    setInvoiceNumber("");
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

      <SearchInput value={search} onChange={setSearch} placeholder="Search by number, client, email, ID or PaymentIntent…" />

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
                <th className="px-4 py-3 font-medium">Due</th>
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
                  <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3">{inv.clientName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(inv.issueDate).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(inv.dueDate).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3 font-medium">€{inv.total.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={inv.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleDownload(inv.id, inv.invoiceNumber)}
                        disabled={downloadingId === inv.id}
                        className="text-muted-foreground hover:text-primary disabled:opacity-50"
                        title="Download PDF"
                      >
                        {downloadingId === inv.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Download className="size-4" />
                        )}
                      </button>
                      <button
                        onClick={() => sendInvoice.mutate(inv.id)}
                        disabled={sendInvoice.isPending && sendInvoice.variables === inv.id}
                        className="text-muted-foreground hover:text-primary disabled:opacity-50"
                        title="Send by email"
                      >
                        {sendInvoice.isPending && sendInvoice.variables === inv.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Send className="size-4" />
                        )}
                      </button>
                      {inv.status !== "paid" && (
                        <button
                          onClick={() => requestPaymentLink(inv)}
                          disabled={checkoutLoading && paymentLinkInvoice?.id === inv.id}
                          className="text-muted-foreground hover:text-primary disabled:opacity-50"
                          title="Send Payment Link"
                        >
                          {checkoutLoading && paymentLinkInvoice?.id === inv.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Link2 className="size-4" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => openEditForm(inv)}
                        className="text-muted-foreground hover:text-primary"
                        title="Edit invoice"
                      >
                        <Pencil className="size-4" />
                      </button>
                      {inv.status !== "paid" && (
                        <button
                          onClick={() => markPaid.mutate(inv.id)}
                          className="text-muted-foreground hover:text-[#4C7A56]"
                          title="Mark as paid"
                        >
                          <CheckCircle2 className="size-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(inv.id, inv.invoiceNumber)}
                        disabled={deleteInvoice.isPending && deleteInvoice.variables === inv.id}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                        title="Delete invoice"
                      >
                        {deleteInvoice.isPending && deleteInvoice.variables === inv.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </button>
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
                  onClick={() => { sendInvoice.mutate(paymentLinkInvoice.id); setPaymentLinkInvoice(null); }}
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
    </div>
  );
}