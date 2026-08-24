import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Plus, Trash2, X, Minus, Pencil, Loader2 } from "lucide-react";

type Pkg = {
  id: number;
  name: string;
  clientId: number;
  clientName: string | null;
  totalSessions: number;
  sessionsUsed: number;
  price: number;
  expiresAt: string | null;
  notes: string | null;
};
type Client = { id: number; name: string };

export default function PackagesPage() {
  return (
    <Protected>
      <PackagesContent />
    </Protected>
  );
}

function PackagesContent() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  const pkgs = useQuery({
    queryKey: ["packages"],
    queryFn: async (): Promise<Pkg[]> => ((await (await api.packages.$get()).json()) as { packages: Pkg[] }).packages,
  });
  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: async (): Promise<Client[]> => ((await (await api.clients.$get()).json()) as { clients: Client[] }).clients,
  });

  const redeem = useMutation({
    mutationFn: async (id: number) => (await api.packages[":id"].use.$post({ param: { id: String(id) } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages"] });
      notify("Sessão descontada.");
    },
    onError: (e: any) => notify(e?.message ?? "Erro."),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => (await api.packages[":id"].$delete({ param: { id: String(id) } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages"] });
      notify("Pacote removido.");
    },
  });
  const save = useMutation({
    mutationFn: async (data: any) =>
      editing
        ? (await api.packages[":id"].$put({ param: { id: String(editing.id) }, json: data })).json()
        : (await api.packages.$post({ json: data })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["packages"] });
      setShowForm(false);
      setEditing(null);
      notify("Guardado.");
    },
  });

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-md text-sm font-medium bg-[#4C7A56] text-white">
          {toast}
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-brand-teal">Pacotes &amp; Créditos</h1>
          <p className="text-muted-foreground mt-1">Sessões pré-pagas por cliente</p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90"
        >
          <Plus className="size-4" /> Novo pacote
        </button>
      </div>

      {pkgs.isLoading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Pacote</th>
                  <th className="px-4 py-3 font-medium">Sessões</th>
                  <th className="px-4 py-3 font-medium">Restantes</th>
                  <th className="px-4 py-3 font-medium">Preço</th>
                  <th className="px-4 py-3 font-medium">Expira</th>
                  <th className="px-4 py-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {(pkgs.data ?? []).map((p) => {
                  const remaining = p.totalSessions - p.sessionsUsed;
                  const expired = p.expiresAt && new Date(p.expiresAt) < new Date();
                  return (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{p.clientName ?? "—"}</td>
                      <td className="px-4 py-3">{p.name}</td>
                      <td className="px-4 py-3">
                        {p.sessionsUsed}/{p.totalSessions}
                      </td>
                      <td className="px-4 py-3 font-semibold text-brand-copper">{remaining}</td>
                      <td className="px-4 py-3">€{p.price.toFixed(2)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.expiresAt ? new Date(p.expiresAt).toLocaleDateString("en-GB") : "—"}
                        {expired ? " (expirado)" : ""}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => redeem.mutate(p.id)}
                            disabled={remaining <= 0 || redeem.isPending}
                            title="Descontar sessão"
                            className="p-1.5 rounded text-muted-foreground hover:text-primary disabled:opacity-40"
                          >
                            {redeem.isPending && redeem.variables === p.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Minus className="size-4" />
                            )}
                          </button>
                          <button
                            onClick={() => {
                              setEditing(p);
                              setShowForm(true);
                            }}
                            className="p-1.5 rounded text-muted-foreground hover:text-primary"
                            title="Editar"
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Remover pacote de ${p.clientName ?? "?"}?`)) remove.mutate(p.id);
                            }}
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {(pkgs.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Sem pacotes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <PackageForm
          editing={editing}
          clients={clients.data ?? []}
          saving={save.isPending}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSave={(data) => save.mutate(data)}
        />
      )}
    </div>
  );
}

function PackageForm(props: {
  editing: Pkg | null;
  clients: Client[];
  saving: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
}) {
  const { editing, clients, saving, onClose, onSave } = props;
  const [clientId, setClientId] = useState(editing?.clientId ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [totalSessions, setTotalSessions] = useState(String(editing?.totalSessions ?? 5));
  const [price, setPrice] = useState(String(editing?.price ?? 0));
  const [expiresAt, setExpiresAt] = useState(editing?.expiresAt ? editing.expiresAt.slice(0, 10) : "");
  const [notes, setNotes] = useState(editing?.notes ?? "");

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl p-6 w-full max-w-sm space-y-3 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground">
          <X className="size-4" />
        </button>
        <h2 className="font-display text-xl font-semibold">{editing ? "Editar pacote" : "Novo pacote"}</h2>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="">Selecionar cliente…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome (ex: Pacote 5 sessões)"
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            type="number"
            min={1}
            value={totalSessions}
            onChange={(e) => setTotalSessions(e.target.value)}
            placeholder="Sessões"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Preço"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
        </div>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          title="Validade (opcional)"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas (opcional)"
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
        <div className="flex justify-end gap-3 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent">
            Cancelar
          </button>
          <button
            disabled={saving || !clientId || !name}
            onClick={() =>
              onSave({
                clientId: Number(clientId),
                name,
                totalSessions: Number(totalSessions),
                price: Number(price) || 0,
                expiresAt: expiresAt || null,
                notes: notes || null,
              })
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" />} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}


