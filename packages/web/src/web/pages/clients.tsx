import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Plus, Search, Mail, Phone, X } from "lucide-react";

export default function ClientsPage() {
  return (
    <Protected>
      <ClientsContent />
    </Protected>
  );
}

function ClientsContent() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const qc = useQueryClient();

  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: async () => (await api.clients.$get()).json(),
  });

  const createClient = useMutation({
    mutationFn: async (data: any) => (await api.clients.$post({ json: data })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      setShowForm(false);
    },
  });

  const filtered = (clients.data?.clients ?? []).filter((c) =>
    [c.name, c.email, c.phone].filter(Boolean).some((v) => v!.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Clients</h1>
          <p className="text-muted-foreground mt-1">{clients.data?.clients.length ?? 0} clients</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="size-4" /> Add client
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients…"
          className="w-full h-10 pl-9 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {clients.isLoading ? (
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
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">City</th>
                <th className="px-4 py-3 font-medium">Country</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-accent/40 transition-colors">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      {c.email && (
                        <span className="flex items-center gap-1.5">
                          <Mail className="size-3" /> {c.email}
                        </span>
                      )}
                      {c.phone && (
                        <span className="flex items-center gap-1.5">
                          <Phone className="size-3" /> {c.phone}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.city ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.country ?? "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No clients found.
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
          <div className="bg-card rounded-xl p-6 w-full max-w-md space-y-4 relative">
            <button onClick={() => setShowForm(false)} className="absolute top-4 right-4 text-muted-foreground">
              <X className="size-4" />
            </button>
            <h2 className="font-display text-xl font-semibold">Add client</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                createClient.mutate({
                  name: fd.get("name"),
                  email: fd.get("email"),
                  phone: fd.get("phone"),
                  address: fd.get("address"),
                  city: fd.get("city"),
                  country: fd.get("country"),
                });
              }}
              className="space-y-3"
            >
              <input name="name" required placeholder="Name" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
              <input name="email" type="email" placeholder="Email" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
              <input name="phone" placeholder="Phone" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
              <input name="address" placeholder="Address" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <input name="city" placeholder="City" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
                <input name="country" placeholder="Country" className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm" />
              </div>
              <Button type="submit" className="w-full" disabled={createClient.isPending}>
                {createClient.isPending ? "Saving…" : "Save client"}
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
