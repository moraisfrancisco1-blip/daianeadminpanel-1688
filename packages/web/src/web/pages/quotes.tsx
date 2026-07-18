import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { StatusPill } from "../components/status-pill";
import { LineItemEditor, LineItemDraft } from "../components/line-item-editor";
import { Plus, X, ArrowRightCircle } from "lucide-react";

export default function QuotesPage() {
  return (
    <Protected>
      <QuotesContent />
    </Protected>
  );
}

function QuotesContent() {
  const [showForm, setShowForm] = useState(false);
  const [clientId, setClientId] = useState<number | null>(null);
  const [items, setItems] = useState<LineItemDraft[]>([{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.09 }]);
  const qc = useQueryClient();

  const quotes = useQuery({
    queryKey: ["quotes"],
    queryFn: async () => (await api.quotes.$get()).json(),
  });
  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: async () => (await api.clients.$get()).json(),
  });
  const services = useQuery({
    queryKey: ["services"],
    queryFn: async () => (await api.services.$get()).json(),
  });

  const createQuote = useMutation({
    mutationFn: async () => (await api.quotes.$post({ json: { clientId, items } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      setShowForm(false);
      setItems([{ description: "", quantity: 1, unitPrice: 0, vatRate: 0.09 }]);
    },
  });

  const convert = useMutation({
    mutationFn: async (id: number) => (await api.quotes[":id"].convert.$post({ param: { id: String(id) } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Quotes</h1>
          <p className="text-muted-foreground mt-1">Proposals before invoicing</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="size-4" /> New quote
        </Button>
      </div>

      {quotes.isLoading ? (
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
                <th className="px-4 py-3 font-medium">Quote #</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(quotes.data?.quotes ?? []).map((q) => (
                <tr key={q.id} className="border-t border-border hover:bg-accent/40 transition-colors">
                  <td className="px-4 py-3 font-medium">{q.quoteNumber}</td>
                  <td className="px-4 py-3">{q.clientName ?? "—"}</td>
                  <td className="px-4 py-3 font-medium">€{q.total.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={q.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!q.convertedInvoiceId && (
                      <button
                        onClick={() => convert.mutate(q.id)}
                        className="text-muted-foreground hover:text-primary inline-flex items-center gap-1.5 text-xs font-medium"
                      >
                        <ArrowRightCircle className="size-4" /> Convert to invoice
                      </button>
                    )}
                    {q.convertedInvoiceId && <span className="text-xs text-muted-foreground">Converted</span>}
                  </td>
                </tr>
              ))}
              {(quotes.data?.quotes ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No quotes yet.
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
            <h2 className="font-display text-xl font-semibold">New quote</h2>
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
              disabled={!clientId || createQuote.isPending}
              onClick={() => createQuote.mutate()}
            >
              {createQuote.isPending ? "Creating…" : "Create quote"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
