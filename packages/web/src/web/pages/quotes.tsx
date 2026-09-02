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
import { Plus, X, ArrowRightCircle, Pencil, Trash2, Loader2 } from "lucide-react";

export default function QuotesPage() {
  return (
    <Protected>
      <QuotesContent />
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

interface QuoteRow {
  id: number;
  quoteNumber: string;
  clientId: number;
  clientName: string | null;
  status: string;
  issueDate: string;
  total: number;
  convertedInvoiceId: number | null;
}

type QuoteSortKey = "number" | "client" | "date" | "total" | "status";
const quoteComparators: Record<QuoteSortKey, (a: QuoteRow, b: QuoteRow) => number> = {
  number: (a, b) => cmpNumberLike(a.quoteNumber, b.quoteNumber),
  client: (a, b) => cmpStr(a.clientName, b.clientName),
  date: (a, b) => cmpDate(a.issueDate, b.issueDate),
  total: (a, b) => cmpNum(a.total, b.total),
  status: (a, b) => cmpStr(a.status, b.status),
};

interface QuoteDetailItem {
  description: string;
  serviceId: number | null;
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

function QuotesContent() {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [items, setItems] = useState<LineItemDraft[]>([{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.09 }]);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [deletePendingId, setDeletePendingId] = useState<number | null>(null);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { sortKey, sortDir, toggle } = useSort<QuoteSortKey>("date", "desc");

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }

  const { data: quotesData, isLoading: quotesLoading } = useQuery({
    queryKey: ["quotes"],
    queryFn: async () => {
      const res = await api.quotes.$get();
      const data = await res.json();
      return data as { quotes: QuoteRow[] };
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

  const createQuote = useMutation({
    mutationFn: async () => {
      const res = await api.quotes.$post({ json: { clientId, items } });
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      setShowForm(false);
      resetForm();
    },
  });

  const updateQuote = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/quotes/${editId}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, items }),
      });
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      setShowForm(false);
      setEditId(null);
      resetForm();
      showToast("success", "Quote updated.");
    },
    onError: () => showToast("error", "Failed to update quote."),
  });

  const deleteQuote = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.quotes[":id"].$delete({ param: { id: String(id) } });
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      showToast("success", "Quote deleted.");
      setDeletePendingId(null);
    },
    onError: () => {
      showToast("error", "Failed to delete quote.");
      setDeletePendingId(null);
    },
  });

  const convert = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.quotes[":id"].convert.$post({ param: { id: String(id) } });
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  function resetForm() {
    setClientId(null);
    setItems([{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.09 }]);
  }

  function openNewForm() {
    setEditId(null);
    resetForm();
    setShowForm(true);
  }

  async function openEditForm(q: QuoteRow) {
    try {
      const res = await fetch(`/api/quotes/${q.id}`);
      const data = await res.json();
      if (!res.ok) return;
      setEditId(q.id);
      setClientId(data.client?.id ?? null);
      setItems(
        (data.items as QuoteDetailItem[] ?? []).map((i) => ({
          description: i.description,
          serviceId: i.serviceId ?? null,
          quantity: i.quantity,
          unitPrice: netToGross(i.unitPrice, i.vatRate),
          vatRate: i.vatRate,
        })),
      );
      setShowForm(true);
    } catch {
      showToast("error", "Failed to load quote details.");
    }
  }

  function handleDelete(id: number, quoteNumber: string) {
    if (window.confirm(`Delete quote ${quoteNumber}? This cannot be undone.`)) {
      setDeletePendingId(id);
      deleteQuote.mutate(id);
    }
  }

  function handleSubmit() {
    if (editId !== null) {
      updateQuote.mutate();
    } else {
      createQuote.mutate();
    }
  }

  const isEditing = editId !== null;
  const quotes = quotesData?.quotes ?? [];
  const clients = clientsData?.clients ?? [];
  const services = servicesData?.services ?? [];

  const q = normalize(search);
  const exactId = idFromQuery(search);
  const filtered = quotes.filter((quote) => {
    if (statusFilter !== "all" && quote.status !== statusFilter) return false;
    if (!q) return true;
    if (matchesId(quote.id, search)) return true;
    return normalize([quote.quoteNumber, quote.clientName].filter(Boolean).join(" ")).includes(q);
  });
  const sorted = [...filtered].sort((a, b) => applyDir(quoteComparators[sortKey](a, b), sortDir));

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
          <h1 className="font-display text-3xl font-semibold">Quotes</h1>
          <p className="text-muted-foreground mt-1">Proposals before invoicing</p>
        </div>
        <Button onClick={openNewForm}>
          <Plus className="size-4" /> New quote
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by number, client or #ID…" />
        <StatusFilter
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All" },
            { value: "draft", label: "Draft" },
            { value: "sent", label: "Sent" },
            { value: "accepted", label: "Accepted" },
            { value: "declined", label: "Declined" },
          ]}
        />
      </div>

      {quotesLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <SortableTh label="Quote #" active={sortKey === "number"} dir={sortDir} onClick={() => toggle("number")} />
                <SortableTh label="Client" active={sortKey === "client"} dir={sortDir} onClick={() => toggle("client")} />
                <SortableTh label="Date" active={sortKey === "date"} dir={sortDir} onClick={() => toggle("date")} />
                <SortableTh label="Total" active={sortKey === "total"} dir={sortDir} onClick={() => toggle("total")} />
                <SortableTh label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggle("status")} />
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((q) => {
                const isExact = exactId !== null && q.id === exactId;
                return (
                <tr key={q.id} className={`border-t border-border hover:bg-accent/40 transition-colors ${isExact ? "bg-primary/10" : ""}`}>
                  <td className="px-4 py-3 font-medium">{q.quoteNumber}</td>
                  <td className="px-4 py-3">{q.clientName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(q.issueDate).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3 font-medium">€{q.total.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={q.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {!q.convertedInvoiceId && (
                        <>
                          <button
                            onClick={() => openEditForm(q)}
                            className="text-muted-foreground hover:text-primary"
                            title="Edit quote"
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            onClick={() => convert.mutate(q.id)}
                            className="text-muted-foreground hover:text-primary"
                            title="Convert to invoice"
                          >
                            <ArrowRightCircle className="size-4" />
                          </button>
                        </>
                      )}
                      {q.convertedInvoiceId && (
                        <span className="text-xs text-muted-foreground">Converted</span>
                      )}
                      <button
                        onClick={() => handleDelete(q.id, q.quoteNumber)}
                        disabled={deletePendingId === q.id}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                        title="Delete quote"
                      >
                        {deletePendingId === q.id ? (
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
              {sorted.length === 0 && <EmptyRow colSpan={6} searching={q.length > 0} noun="quotes" />}
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
            <h2 className="font-display text-xl font-semibold">{isEditing ? "Edit quote" : "New quote"}</h2>
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
              disabled={!clientId || createQuote.isPending || updateQuote.isPending}
              onClick={handleSubmit}
            >
              {createQuote.isPending || updateQuote.isPending
                ? "Saving…"
                : isEditing
                  ? "Update quote"
                  : "Create quote"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}