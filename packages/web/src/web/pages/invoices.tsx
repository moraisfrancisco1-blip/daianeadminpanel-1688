import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { StatusPill } from "../components/status-pill";
import { LineItemEditor, LineItemDraft } from "../components/line-item-editor";
import { Plus, X, Download, Send, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { downloadFile } from "../lib/download";

export default function InvoicesPage() {
  return (
    <Protected>
      <InvoicesContent />
    </Protected>
  );
}

function InvoicesContent() {
  const [showForm, setShowForm] = useState(false);
  const [clientId, setClientId] = useState<number | null>(null);
  const [items, setItems] = useState<LineItemDraft[]>([{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.09 }]);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const qc = useQueryClient();

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

  const invoices = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => (await api.invoices.$get()).json(),
  });
  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: async () => (await api.clients.$get()).json(),
  });
  const services = useQuery({
    queryKey: ["services"],
    queryFn: async () => (await api.services.$get()).json(),
  });

  const createInvoice = useMutation({
    mutationFn: async () => (await api.invoices.$post({ json: { clientId, items } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setShowForm(false);
      setItems([{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.09 }]);
    },
  });

  const markPaid = useMutation({
    mutationFn: async (id: number) =>
      (await api.invoices[":id"].status.$put({ param: { id: String(id) }, json: { status: "paid" } })).json(),
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
    mutationFn: async (id: number) => (await api.invoices[":id"].$delete({ param: { id: String(id) } })).json(),
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
          <p className="text-muted-foreground mt-1">{invoices.data?.invoices.length ?? 0} invoices</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="size-4" /> New invoice
        </Button>
      </div>

      {invoices.isLoading ? (
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
                <th className="px-4 py-3 font-medium">Invoice #</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Due</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(invoices.data?.invoices ?? []).map((inv) => (
                <tr key={inv.id} className="border-t border-border hover:bg-accent/40 transition-colors">
                  <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3">{inv.clientName ?? "—"}</td>
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
              ))}
              {(invoices.data?.invoices ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No invoices yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl p-6 w-full max-w-2xl space-y-4 relative">
            <button onClick={() => setShowForm(false)} className="absolute top-4 right-4 text-muted-foreground">
              <X className="size-4" />
            </button>
            <h2 className="font-display text-xl font-semibold">New invoice</h2>
            <select
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              value={clientId ?? ""}
              onChange={(e) => setClientId(Number(e.target.value))}
            >
              <option value="">Select client…</option>
              {(clients.data?.clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <LineItemEditor items={items} onChange={setItems} services={services.data?.services ?? []} />
            <Button
              className="w-full"
              disabled={!clientId || createInvoice.isPending}
              onClick={() => createInvoice.mutate()}
            >
              {createInvoice.isPending ? "Creating…" : "Create invoice"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
