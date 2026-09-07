import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Euro,
  CalendarClock,
  FileText,
  Receipt,
  StickyNote,
  Check,
  HeartPulse,
  Save,
  Undo2,
  PackageIcon,
  MessageCircle,
  History,
} from "lucide-react";
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
type ClientPackage = {
  id: number;
  name: string;
  totalSessions: number;
  sessionsUsed: number;
  price: number;
  expiresAt: string | null;
  purchasedAt: string;
};
type TimelineEntry = { date: string; type: string; title: string; detail: string; status?: string };

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
  const [timelineFilter, setTimelineFilter] = useState<string>("all");

  const q = useQuery({
    queryKey: ["client", id],
    queryFn: async (): Promise<{
      client: Client;
      invoices: Invoice[];
      quotes: Quote[];
      payments: Payment[];
      bookings: Booking[];
      notes: ClientNote[];
      packages: ClientPackage[];
      timeline: TimelineEntry[];
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
  if (!q.data) return <p className="text-muted-foreground">Client not found.</p>;

  const { client, invoices, quotes, payments, bookings, notes, packages, timeline } = q.data;
  const pendingNotes = notes.filter((n) => !n.resolved);
  const resolvedNotes = notes.filter((n) => n.resolved);

  const paidTotal = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.total, 0);
  const pendingTotal = invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled").reduce((s, i) => s + i.total, 0);
  const sessionsCount = bookings.filter((b) => b.status === "confirmed" || b.status === "completed").length;
  const upcoming = bookings.filter((b) => (b.status === "confirmed" || b.status === "pending_deposit") && b.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date));
  const nextSession = upcoming[0];
  const activePackages = packages.filter((p) => p.sessionsUsed < p.totalSessions && (!p.expiresAt || new Date(p.expiresAt).getTime() >= Date.now()));

  return (
    <div className="space-y-6">
      <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="size-4" /> Back to clients
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
          <p className="text-xs text-muted-foreground">Pending balance</p>
          <p className={`text-2xl font-display font-semibold ${pendingTotal > 0 ? "text-brand-copper" : ""}`}>€{pendingTotal.toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs text-muted-foreground">Total paid</p>
          <p className="text-2xl font-display font-semibold text-[#4C7A56]">€{paidTotal.toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs text-muted-foreground">Sessions</p>
          <p className="text-2xl font-display font-semibold">{sessionsCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs text-muted-foreground">Next session</p>
          <p className="text-2xl font-display font-semibold">
            {nextSession ? `${nextSession.date.slice(8, 10)}/${nextSession.date.slice(5, 7)}` : "—"}
          </p>
          {nextSession && <p className="text-xs text-muted-foreground">{nextSession.startTime} · {nextSession.serviceName ?? "—"}</p>}
        </div>
      </div>

      <ClientTimeline timeline={timeline} filter={timelineFilter} onFilterChange={setTimelineFilter} />

      {client.notes && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-medium mb-2">Internal notes</h3>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{client.notes}</p>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-medium mb-3 flex items-center gap-2">
          <HeartPulse className="size-4 text-brand-copper" /> Clinical notes
        </h3>
        <textarea
          ref={clinicalNotesRef}
          defaultValue={client.clinicalNotes ?? ""}
          placeholder="Areas of tension, contraindications, treatment history…"
          rows={4}
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={() => saveClinicalNotes.mutate(clinicalNotesRef.current?.value ?? "")}
            disabled={saveClinicalNotes.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50"
          >
            <Save className="size-3.5" /> {saveClinicalNotes.isPending ? "Saving…" : "Save"}
          </button>
          {clinicalNotesSaved && <span className="text-xs text-[#4C7A56]">Saved.</span>}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-medium mb-3 flex items-center gap-2">
          <StickyNote className="size-4 text-brand-copper" /> Follow-up notes
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
            placeholder="Write a note to follow up on later…"
            rows={2}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm resize-none"
          />
          <button
            type="submit"
            disabled={!newNote.trim() || addNote.isPending}
            className="rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 py-2 disabled:opacity-50 shrink-0"
          >
            Add
          </button>
        </form>

        {pendingNotes.length === 0 && resolvedNotes.length === 0 && (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
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
                  <Check className="size-3.5" /> Resolved
                </button>
              </div>
            ))}
          </div>
        )}

        {resolvedNotes.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {resolvedNotes.length} resolved note{resolvedNotes.length === 1 ? "" : "s"}
            </summary>
            <div className="space-y-2 mt-2">
              {resolvedNotes.map((n) => (
                <div key={n.id} className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2 opacity-60">
                  <div className="min-w-0">
                    <p className="text-sm whitespace-pre-wrap line-through">{n.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(n.createdAt).toLocaleDateString("en-GB")}
                      {n.resolvedAt && ` · resolved on ${new Date(n.resolvedAt).toLocaleDateString("en-GB")}`}
                    </p>
                  </div>
                  <button
                    onClick={() => unresolveNote.mutate(n.id)}
                    disabled={unresolveNote.isPending}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-copper hover:underline shrink-0 disabled:opacity-50"
                  >
                    <Undo2 className="size-3.5" /> Revert
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-medium mb-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <PackageIcon className="size-4 text-brand-copper" /> Session packages
          </span>
          <Link to={`/packages?clientId=${id}`} className="text-xs font-medium text-brand-teal hover:underline">
            Manage packages
          </Link>
        </h3>
        {packages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No packages purchased.</p>
        ) : (
          <div className="space-y-2">
            {packages.map((p) => {
              const remaining = p.totalSessions - p.sessionsUsed;
              const expired = !!p.expiresAt && new Date(p.expiresAt).getTime() < Date.now();
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 text-sm rounded-lg border border-border px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.sessionsUsed}/{p.totalSessions} sessions used
                      {p.expiresAt && ` · expires ${new Date(p.expiresAt).toLocaleDateString("en-GB")}`}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                      expired
                        ? "bg-red-600/12 text-red-700"
                        : remaining > 0
                          ? "bg-[#3F6B52]/12 text-[#3F6B52]"
                          : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {expired ? "Expired" : `${remaining} left`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {activePackages.length === 0 && packages.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">No active packages with remaining sessions.</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-medium mb-4 flex items-center gap-2">
            <CalendarClock className="size-4 text-brand-copper" /> Upcoming sessions
          </h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming sessions.</p>
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
            <Euro className="size-4 text-brand-copper" /> Payments
          </h3>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded.</p>
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
                <th className="px-6 py-3 font-medium">No.</th>
                <th className="px-4 py-3 font-medium">Issued</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
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
                    No invoices.
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
                <th className="px-6 py-3 font-medium">No.</th>
                <th className="px-4 py-3 font-medium">Issued</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
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
                    No quotes.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <h3 className="font-medium p-6 pb-3">Session history</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-6 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Status</th>
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
                    No sessions.
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

const TIMELINE_FILTERS = [
  { value: "all", label: "All" },
  { value: "invoice", label: "Invoices" },
  { value: "quote", label: "Quotes" },
  { value: "payment", label: "Payments" },
  { value: "booking", label: "Sessions" },
  { value: "note", label: "Notes" },
  { value: "package", label: "Packages" },
  { value: "email", label: "Emails" },
  { value: "message", label: "Messages" },
];

const TIMELINE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  invoice: Receipt,
  quote: FileText,
  payment: Euro,
  booking: CalendarClock,
  note: StickyNote,
  package: PackageIcon,
  email: Mail,
  message: MessageCircle,
};

const TIMELINE_COLOR: Record<string, string> = {
  invoice: "bg-brand-copper/15 text-brand-copper",
  quote: "bg-brand-teal/15 text-brand-teal",
  payment: "bg-[#3F6B52]/15 text-[#3F6B52]",
  booking: "bg-brand-bronze/15 text-brand-bronze",
  note: "bg-amber-500/15 text-amber-600",
  package: "bg-purple-500/15 text-purple-600",
  email: "bg-sky-500/15 text-sky-600",
  message: "bg-emerald-500/15 text-emerald-600",
};

function ClientTimeline(props: { timeline: TimelineEntry[]; filter: string; onFilterChange: (v: string) => void }) {
  const { timeline, filter, onFilterChange } = props;
  const filtered = filter === "all" ? timeline : timeline.filter((e) => e.type === filter);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h3 className="font-medium flex items-center gap-2">
          <History className="size-4 text-brand-copper" /> Timeline
        </h3>
        <select
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          className="h-8 px-2 rounded-md border border-input bg-background text-xs"
        >
          {TIMELINE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <div className="space-y-0 max-h-[420px] overflow-y-auto pr-1">
          {filtered.map((entry, i) => {
            const Icon = TIMELINE_ICON[entry.type] ?? History;
            return (
              <div key={i} className="flex items-start gap-3 py-2.5 border-t border-border first:border-t-0">
                <span className={`shrink-0 size-7 rounded-full flex items-center justify-center ${TIMELINE_COLOR[entry.type] ?? "bg-secondary text-muted-foreground"}`}>
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{entry.title}</p>
                    <p className="text-xs text-muted-foreground shrink-0">{new Date(entry.date).toLocaleDateString("en-GB")}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-muted-foreground truncate">{entry.detail}</p>
                    {entry.status && <StatusPill status={entry.status} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
