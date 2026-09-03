import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Link, useParams } from "wouter";
import { ArrowLeft, Mail, Phone, MapPin, Euro, CalendarClock, FileText, Receipt, StickyNote, Check, HeartPulse, Save, Undo2 } from "lucide-react";
import { StatusPill } from "../components/status-pill";

type Client = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  notes: string | null;
  clinicalNotes: string | null;
  createdAt: string;
};
type Invoice = { id: number; invoiceNumber: string; status: string; issueDate: string; dueDate: string; total: number; paidAt: string | null };
type Quote = { id: number; quoteNumber: string; status: string; issueDate: string; total: number };
type Payment = { id: number; amount: number; method: string; paidAt: string };
type Booking = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  serviceName: string | null;
  date: string;
  startTime: string;
  status: string;
  depositAmount: number;
  depositStatus: string;
};
type ClientNote = { id: number; content: string; resolved: boolean; resolvedAt: string | null; createdAt: string };

export default function ClientDetailPage() {
  return (
    <Protected>
      <ClientDetailContent />
    </Protected>
  );
}

function ClientDetailContent() {
  const params = useParams();
  const id = params.id ?? "";
  const qc = useQueryClient();
  const [newNote, setNewNote] = useState("");
  const clinicalNotesRef = useRef<HTMLTextAreaElement>(null);
  const [clinicalNotesSaved, setClinicalNotesSaved] = useState(false);

  const q = useQuery({
    queryKey: ["client", id],
    queryFn: async (): Promise<{
      client: Client;
      invoices: Invoice[];
      quotes: Quote[];
      payments: Payment[];
      bookings: Booking[];
      notes: ClientNote[];
    }> => {
      const res = await api.clients[":id"].$get({ param: { id } });
      return (await res.json()) as any;
    },
    enabled: !!id,
  });

  const addNote = useMutation({
    mutationFn: async (content: string) =>
      (await api.clients[":id"].notes.$post({ param: { id }, json: { content } } as any)).json(),
    onSuccess: () => {
      setNewNote("");
      qc.invalidateQueries({ queryKey: ["client", id] });
      qc.invalidateQueries({ queryKey: ["dashboard-alerts"] });
    },
  });

  const resolveNote = useMutation({
    mutationFn: async (noteId: number) =>
      (
        await api.clients[":id"].notes[":noteId"].resolve.$put({
          param: { id, noteId: String(noteId) },
        } as any)
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client", id] });
      qc.invalidateQueries({ queryKey: ["dashboard-alerts"] });
    },
  });

  const unresolveNote = useMutation({
    mutationFn: async (noteId: number) =>
      (
        await api.clients[":id"].notes[":noteId"].unresolve.$put({
          param: { id, noteId: String(noteId) },
        } as any)
      ).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client", id] });
      qc.invalidateQueries({ queryKey: ["dashboard-alerts"] });
    },
  });

  const saveClinicalNotes = useMutation({
    mutationFn: async (clinicalNotes: string) =>
      (await api.clients[":id"].$put({ param: { id }, json: { clinicalNotes } } as any)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client", id] });
      setClinicalNotesSaved(true);
      setTimeout(() => setClinicalNotesSaved(false), 2000);
    },
  });

  if (q.isLoading) {
    return <div className="space-y-4">{[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>;
  }
  if (!q.data) return <p className="text-muted-foreground">Cliente não encontrado.</p>;

  const { client, invoices, quotes, payments, bookings, notes } = q.data;
  const pendingNotes = notes.filter((n) => !n.resolved);
  const resolvedNotes = notes.filter((n) => n.resolved);

  const paidTotal = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.total, 0);
  const pendingTotal = invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled").reduce((s, i) => s + i.total, 0);
  const sessionsCount = bookings.filter((b) => b.status === "confirmed" || b.status === "completed").length;
  const upcoming = bookings.filter((b) => (b.status === "confirmed" || b.status === "pending_deposit") && b.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date));
  const nextSession = upcoming[0];

  return (
    <div className="space-y-6">
      <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="size-4" /> Voltar aos clientes
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-brand-teal">{client.name}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
            {client.email && (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="size-3.5" /> {client.email}
              </span>
            )}
            {client.phone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5" /> {client.phone}
              </span>
            )}
            {(client.address || client.city) && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" /> {[client.address, client.city, client.country].filter(Boolean).join(", ")}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs text-muted-foreground">Saldo pendente</p>
          <p className={`text-2xl font-display font-semibold ${pendingTotal > 0 ? "text-brand-copper" : ""}`}>€{pendingTotal.toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs text-muted-foreground">Total pago</p>
          <p className="text-2xl font-display font-semibold text-[#4C7A56]">€{paidTotal.toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs text-muted-foreground">Sessões</p>
          <p className="text-2xl font-display font-semibold">{sessionsCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs text-muted-foreground">Próxima sessão</p>
          <p className="text-2xl font-display font-semibold">
            {nextSession ? `${nextSession.date.slice(8, 10)}/${nextSession.date.slice(5, 7)}` : "—"}
          </p>
          {nextSession && <p className="text-xs text-muted-foreground">{nextSession.startTime} · {nextSession.serviceName ?? "—"}</p>}
        </div>
      </div>

      {client.notes && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-medium mb-2">Notas internas</h3>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{client.notes}</p>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-medium mb-3 flex items-center gap-2">
          <HeartPulse className="size-4 text-brand-copper" /> Notas clínicas
        </h3>
        <textarea
          ref={clinicalNotesRef}
          defaultValue={client.clinicalNotes ?? ""}
          placeholder="Zonas de tensão, contraindicações, historial de tratamento…"
          rows={4}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={() => saveClinicalNotes.mutate(clinicalNotesRef.current?.value ?? "")}
            disabled={saveClinicalNotes.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50"
          >
            <Save className="size-3.5" /> {saveClinicalNotes.isPending ? "A guardar…" : "Guardar"}
          </button>
          {clinicalNotesSaved && <span className="text-xs text-[#4C7A56]">Guardado.</span>}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-medium mb-3 flex items-center gap-2">
          <StickyNote className="size-4 text-brand-copper" /> Notas de acompanhamento
        </h3>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const content = newNote.trim();
            if (content) addNote.mutate(content);
          }}
          className="flex items-start gap-2 mb-4"
        >
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Escrever uma nota para tratar mais tarde…"
            rows={2}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm resize-none"
          />
          <button
            type="submit"
            disabled={!newNote.trim() || addNote.isPending}
            className="rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 py-2 disabled:opacity-50 shrink-0"
          >
            Adicionar
          </button>
        </form>

        {pendingNotes.length === 0 && resolvedNotes.length === 0 && (
          <p className="text-sm text-muted-foreground">Sem notas ainda.</p>
        )}

        {pendingNotes.length > 0 && (
          <div className="space-y-2 mb-3">
            {pendingNotes.map((n) => (
              <div
                key={n.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-brand-bronze/30 bg-brand-bronze/5 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm whitespace-pre-wrap">{n.content}</p>
                  <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleDateString("en-GB")}</p>
                </div>
                <button
                  onClick={() => resolveNote.mutate(n.id)}
                  disabled={resolveNote.isPending}
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-teal hover:underline shrink-0 disabled:opacity-50"
                >
                  <Check className="size-3.5" /> Tratada
                </button>
              </div>
            ))}
          </div>
        )}

        {resolvedNotes.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {resolvedNotes.length} nota{resolvedNotes.length === 1 ? "" : "s"} tratada{resolvedNotes.length === 1 ? "" : "s"}
            </summary>
            <div className="space-y-2 mt-2">
              {resolvedNotes.map((n) => (
                <div key={n.id} className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2 opacity-60">
                  <div className="min-w-0">
                    <p className="text-sm whitespace-pre-wrap line-through">{n.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(n.createdAt).toLocaleDateString("en-GB")}
                      {n.resolvedAt && ` · tratada a ${new Date(n.resolvedAt).toLocaleDateString("en-GB")}`}
                    </p>
                  </div>
                  <button
                    onClick={() => unresolveNote.mutate(n.id)}
                    disabled={unresolveNote.isPending}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-copper hover:underline shrink-0 disabled:opacity-50"
                  >
                    <Undo2 className="size-3.5" /> Reverter
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4 flex items-center gap-2">
            <CalendarClock className="size-4 text-brand-copper" /> Próximas sessões
          </h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem sessões futuras.</p>
          ) : (
            <div className="space-y-2">
              {upcoming.slice(0, 5).map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">
                      {new Date(`${b.date}T00:00:00`).toLocaleDateString("en-GB")} · {b.startTime}
                    </p>
                    <p className="text-xs text-muted-foreground">{b.serviceName ?? "—"}</p>
                  </div>
                  <StatusPill status={b.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4 flex items-center gap-2">
            <Euro className="size-4 text-brand-copper" /> Pagamentos
          </h3>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem pagamentos registados.</p>
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <p className="font-medium">€{p.amount.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.method} · {new Date(p.paidAt).toLocaleDateString("en-GB")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <h3 className="font-medium p-6 pb-3 flex items-center gap-2">
          <Receipt className="size-4 text-brand-copper" /> Invoices
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Nº</th>
                <th className="px-4 py-3 font-medium">Emitida</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-border">
                  <td className="px-6 py-3 font-medium">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(inv.issueDate).toLocaleDateString("en-GB")}</td>
                  <td className="px-4 py-3 font-medium">€{inv.total.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={inv.status} />
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-6 text-center text-muted-foreground">
                    Sem invoices.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <h3 className="font-medium p-6 pb-3 flex items-center gap-2">
          <FileText className="size-4 text-brand-copper" /> Quotes
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Nº</th>
                <th className="px-4 py-3 font-medium">Emitida</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className="border-t border-border">
                  <td className="px-6 py-3 font-medium">{q.quoteNumber}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(q.issueDate).toLocaleDateString("en-GB")}</td>
                  <td className="px-4 py-3 font-medium">€{q.total.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={q.status} />
                  </td>
                </tr>
              ))}
              {quotes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-6 text-center text-muted-foreground">
                    Sem quotes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <h3 className="font-medium p-6 pb-3">Histórico de sessões</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Hora</th>
                <th className="px-4 py-3 font-medium">Serviço</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="px-6 py-3">{new Date(`${b.date}T00:00:00`).toLocaleDateString("en-GB")}</td>
                  <td className="px-4 py-3">{b.startTime}</td>
                  <td className="px-4 py-3">{b.serviceName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={b.status} />
                  </td>
                </tr>
              ))}
              {bookings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-6 text-center text-muted-foreground">
                    Sem sessões.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
