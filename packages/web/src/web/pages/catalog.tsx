import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Plus, X, Trash2, Pencil } from "lucide-react";

export default function CatalogPage() {
  return (
    <Protected>
      <CatalogContent />
    </Protected>
  );
}

function CatalogContent() {
  const [showForm, setShowForm] = useState(false);
  const [editingService, setEditingService] = useState<any>(null);
  const qc = useQueryClient();

  const services = useQuery({
    queryKey: ["services"],
    queryFn: async (): Promise<any> => (await api.services.$get()).json(),
  });

  const createService = useMutation({
    mutationFn: async (data: any) => (await api.services.$post({ json: data })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["services"] });
      setShowForm(false);
    },
  });

  const updateService = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await fetch(`/api/services/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update service");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["services"] });
      setEditingService(null);
    },
  });

  const deleteService = useMutation({
    mutationFn: async (id: number) => (await api.services[":id"].$delete({ param: { id: String(id) } })).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["services"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Service Catalog</h1>
          <p className="text-muted-foreground mt-1">Prices and VAT rates per service</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="size-4" /> Add service
        </Button>
      </div>

      {services.isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {[...(services.data?.services ?? [])]
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
            .map((s: any) => (
            <div key={s.id} className={`bg-card border border-border rounded-xl p-5 flex items-start justify-between ${!s.active ? "opacity-50" : ""}`}>
              <div>
                <h3 className="font-medium">{s.name}</h3>
                {s.description && <p className="text-sm text-muted-foreground mt-0.5">{s.description}</p>}
                <p className="text-sm text-muted-foreground mt-1">{s.durationMinutes} min</p>
                {!s.active && <span className="text-xs text-destructive font-medium">Inactive</span>}
              </div>
              <div className="text-right shrink-0 ml-4">
                <p className="font-display text-xl font-semibold text-primary">€{s.price.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">VAT {Math.round(s.vatRate * 100)}%</p>
                <div className="flex items-center gap-2 mt-2 justify-end">
                  <button
                    onClick={() => setEditingService(s)}
                    className="text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${s.name}"?`)) deleteService.mutate(s.id);
                    }}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl p-6 w-full max-w-md space-y-4 relative">
            <button onClick={() => setShowForm(false)} className="absolute top-4 right-4 text-muted-foreground">
              <X className="size-4" />
            </button>
            <h2 className="font-display text-xl font-semibold">Add service</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                createService.mutate({
                  name: fd.get("name"),
                  description: fd.get("description"),
                  durationMinutes: Number(fd.get("durationMinutes")),
                  price: Number(fd.get("price")),
                  vatRate: Number(fd.get("vatRate")),
                });
              }}
              className="space-y-3"
            >
              <input name="name" required placeholder="Service name" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
              <input name="description" placeholder="Description" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <input name="durationMinutes" type="number" defaultValue={60} placeholder="Duration (min)" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
                <input name="price" type="number" step="0.01" required placeholder="Price (€)" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
              </div>
              <select name="vatRate" defaultValue="0.09" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                <option value="0.09">VAT 9%</option>
                <option value="0.21">VAT 21%</option>
                <option value="0">VAT 0% (exempt)</option>
              </select>
              <Button type="submit" className="w-full" disabled={createService.isPending}>
                {createService.isPending ? "Saving…" : "Save service"}
              </Button>
            </form>
          </div>
        </div>
      )}

      {editingService && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl p-6 w-full max-w-md space-y-4 relative">
            <button onClick={() => setEditingService(null)} className="absolute top-4 right-4 text-muted-foreground">
              <X className="size-4" />
            </button>
            <h2 className="font-display text-xl font-semibold">Edit service</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                updateService.mutate({
                  id: editingService.id,
                  data: {
                    name: fd.get("name"),
                    description: fd.get("description"),
                    durationMinutes: Number(fd.get("durationMinutes")),
                    price: Number(fd.get("price")),
                    vatRate: Number(fd.get("vatRate")),
                    active: fd.get("active") === "on",
                    sortOrder: Number(fd.get("sortOrder")),
                  },
                });
              }}
              className="space-y-3"
            >
              <input name="name" required placeholder="Service name" defaultValue={editingService.name} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
              <input name="description" placeholder="Description" defaultValue={editingService.description ?? ""} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <input name="durationMinutes" type="number" defaultValue={editingService.durationMinutes} placeholder="Duration (min)" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
                <input name="price" type="number" step="0.01" required defaultValue={editingService.price} placeholder="Price (€)" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
              </div>
              <select name="vatRate" defaultValue={String(editingService.vatRate)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
                <option value="0.09">VAT 9%</option>
                <option value="0.21">VAT 21%</option>
                <option value="0">VAT 0% (exempt)</option>
              </select>
              <div className="grid grid-cols-2 gap-3">
                <input name="sortOrder" type="number" defaultValue={editingService.sortOrder ?? 0} placeholder="Sort order" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
                <label className="flex items-center gap-2 h-10 px-3">
                  <input name="active" type="checkbox" defaultChecked={editingService.active} className="size-4" />
                  <span className="text-sm">Active</span>
                </label>
              </div>
              <Button type="submit" className="w-full" disabled={updateService.isPending}>
                {updateService.isPending ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}