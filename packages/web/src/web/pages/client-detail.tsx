import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  Euro,
  CalendarClock,
  CalendarPlus,
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
  Mail,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { StatusPill } from "../components/status-pill";

type Client = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  zipCode: string | null;
  city: string | null;
  country: string | null;
  dateOfBirth: string | null;
  occupation: string | null;
  referralSource: string | null;
  preferredLanguage: string | null;
  debtorNumber: string | null;
  tags: string[];
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
  durationMinutes: number | null;
  date: string;
  startTime: string;
  status: string;
  notes: string | null;
  price: number;
  paid: boolean;
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

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB");
const euro = (n: number) => `€${n.toFixed(2)}`;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : "")).toUpperCase();
}

function ageFrom(dobIso: string): number | null {
  const dob = new Date(dobIso);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) age--;
  return age;
}

function endTime(start: string, minutes: number | null): string {
  const [h, m] = start.split(":").map(Number);
  const total = h! * 60 + (m ?? 0) + (minutes ?? 60);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function Card(props: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-medium flex items-center gap-2">{props.title}</h3>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

const linkAction = "text-xs font-medium text-brand-teal hover:underline";

function Field(props: { label: string; children?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 break-words">{props.children || "—"}</dd>
    </div>
  );
}

function DateBadge({ date }: { date: string }) {
  const d = new Date(`${date}T00:00:00`);
  return (
    <div className="shrink-0 w-12 rounded-lg border border-border bg-background text-center py-1 leading-tight">
      <p className="text-base font-display font-semibold">{String(d.getDate()).padStart(2, "0")}</p>
      <p className="text-[10px] text-muted-foreground">{MONTHS[d.getMonth()]}</p>
      <p className="text-[10px] text-muted-foreground">{d.getFullYear()}</p>
    </div>
  );
}

function SessionPill({ b }: { b: Booking }) {
  if (b.status === "cancelled" || b.status === "no_show") return <StatusPill status={b.status} />;
  return b.paid ? (
    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-[#3F6B52]/12 text-[#3F6B52]">Paid</span>
  ) : (
    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-[#955F27]/14 text-[#955F27]">Pending</span>
  );
}

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
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);

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

  const saveTags = useMutation({
    mutationFn: async (tags: string[]) =>
      (await api.clients[":id"].$put({ param: { id }, json: { tags } } as any)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client", id] }),
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
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = bookings
    .filter((b) => (b.status === "confirmed" || b.status === "pending_deposit") && b.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const activePackages = packages.filter((p) => p.sessionsUsed < p.totalSessions && (!p.expiresAt || new Date(p.expiresAt).getTime() >= Date.now()));
  const visibleSessions = showAllSessions ? bookings : bookings.slice(0, 6);
  const visibleInvoices = showAllInvoices ? invoices : invoices.slice(0, 4);
  const age = client.dateOfBirth ? ageFrom(client.dateOfBirth) : null;
  const addressLines = [client.address, [client.zipCode, client.city].filter(Boolean).join(" "), client.country].filter(Boolean);

  function commitTag() {
    const label = tagDraft.trim();
    setTagDraft("");
    setAddingTag(false);
    if (!label || client.tags.some((t) => t.toLowerCase() === label.toLowerCase())) return;
    saveTags.mutate([...client.tags, label]);
  }

  return (
    <div className="space-y-6">
      <Link to="/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="size-4" /> Back to clients
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div
            className="shrink-0 size-16 sm:size-20 rounded-full bg-brand-cream text-brand-teal border border-brand-beige flex items-center justify-center font-display text-xl sm:text-2xl"
            aria-hidden="true"
          >
            {initials(client.name)}
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-brand-teal break-words">{client.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Client since {new Date(client.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
              {" · "}
              {sessionsCount} session{sessionsCount === 1 ? "" : "s"}
              {" · "}#{client.id}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {client.tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full bg-brand-teal/10 text-brand-teal text-xs font-medium">
                  {t}
                  <button
                    type="button"
                    aria-label={`Remove tag ${t}`}
                    onClick={() => saveTags.mutate(client.tags.filter((x) => x !== t))}
                    className="rounded-full hover:bg-brand-teal/15 p-0.5"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {addingTag ? (
                <input
                  ref={tagInputRef}
                  aria-label="New tag"
                  value={tagDraft}
                  maxLength={30}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onBlur={commitTag}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTag();
                    if (e.key === "Escape") {
                      setTagDraft("");
                      setAddingTag(false);
                    }
                  }}
                  placeholder="Tag…"
                  className="h-7 w-28 px-2.5 rounded-full border border-input bg-background text-xs"
                />
              ) : (
                <button
                  type="button"
                  aria-label="Add tag"
                  onClick={() => setAddingTag(true)}
                  className="size-6 rounded-full border border-dashed border-input text-muted-foreground hover:bg-accent flex items-center justify-center"
                >
                  <Plus className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/clients?edit=${client.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent"
          >
            <Pencil className="size-4" /> Edit client
          </Link>
          <Link
            to={`/messages?clientId=${client.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent"
          >
            <MessageCircle className="size-4" /> Send message
          </Link>
          <Link
            to={`/bookings/manual?clientId=${client.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-teal text-white hover:bg-brand-teal-dark"
          >
            <CalendarPlus className="size-4" /> New session
          </Link>
        </div>
      </div>

      {/* Sized by the space the page actually gets (the app has a sidebar), not the screen: 1 → 2 → 3 columns. */}
      <div className="@container">
      <div className="grid grid-cols-1 @3xl:grid-cols-2 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-5 items-start">
        {/* Left: who she is */}
        <div className="space-y-5 @5xl:col-start-1 @5xl:row-start-1">
          <Card title="Personal details" action={<Link to={`/clients?edit=${client.id}`} className={linkAction}>Edit</Link>}>
            <dl>
              <Field label="Date of birth">
                {client.dateOfBirth ? `${new Date(client.dateOfBirth).toLocaleDateString("en-GB")}${age !== null ? ` (${age} years)` : ""}` : null}
              </Field>
              <Field label="Occupation">{client.occupation}</Field>
              <Field label="Found us via">{client.referralSource}</Field>
              <Field label="Language">{client.preferredLanguage}</Field>
              {client.debtorNumber && <Field label="Debtor #">{client.debtorNumber}</Field>}
            </dl>
          </Card>

          <Card title="Contact" action={<Link to={`/clients?edit=${client.id}`} className={linkAction}>Edit</Link>}>
            <dl>
              <Field label="Email">
                {client.email ? (
                  <a href={`mailto:${client.email}`} className="text-brand-teal hover:underline inline-flex items-start gap-1 break-all">
                    <Mail className="size-3.5 shrink-0 mt-0.5" /> {client.email}
                  </a>
                ) : null}
              </Field>
              <Field label="Phone">
                {client.phone ? (
                  <a href={`tel:${client.phone.replace(/\s+/g, "")}`} className="text-brand-teal hover:underline">
                    {client.phone}
                  </a>
                ) : null}
              </Field>
              <Field label="Address">
                {addressLines.length ? addressLines.map((l, i) => <span key={i} className="block">{l}</span>) : null}
              </Field>
            </dl>
          </Card>

          <Card
            title={
              <>
                <HeartPulse className="size-4 text-brand-copper" /> Clinical notes
              </>
            }
          >
            <textarea
              ref={clinicalNotesRef}
              aria-label="Clinical notes"
              defaultValue={client.clinicalNotes ?? ""}
              placeholder="Areas of tension, contraindications, treatment history…"
              rows={5}
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
          </Card>

          <Card
            title={
              <>
                <StickyNote className="size-4 text-brand-copper" /> Notes
              </>
            }
          >
            {client.notes && (
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-1">Internal notes</p>
                <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
              </div>
            )}

            <p className="text-xs text-muted-foreground mb-2">Follow-up notes</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const content = newNote.trim();
                if (content) addNote.mutate(content);
              }}
              className="flex items-start gap-2 mb-4"
            >
              <textarea
                aria-label="New follow-up note"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Write a note to follow up on later…"
                rows={2}
                className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm resize-none"
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
                      <p className="text-xs text-muted-foreground mt-1">{fmtDate(n.createdAt)}</p>
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
                          {fmtDate(n.createdAt)}
                          {n.resolvedAt && ` · resolved on ${fmtDate(n.resolvedAt)}`}
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
          </Card>
        </div>

        {/* Middle: what happened */}
        <div className="space-y-5 @3xl:col-span-2 @3xl:row-start-2 @5xl:col-span-1 @5xl:col-start-2 @5xl:row-start-1">
          <Card
            title={
              <>
                <CalendarClock className="size-4 text-brand-copper" /> Session history
              </>
            }
            action={
              bookings.length > 6 ? (
                <button type="button" onClick={() => setShowAllSessions((v) => !v)} className={linkAction}>
                  {showAllSessions ? "Show fewer" : `View all (${bookings.length})`}
                </button>
              ) : undefined
            }
          >
            {bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sessions yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {visibleSessions.map((b) => {
                  const muted = b.status === "cancelled" || b.status === "no_show";
                  return (
                    <Link
                      key={b.id}
                      to={`/calendar?date=${b.date}`}
                      className={`flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:bg-accent/40 -mx-2 px-2 rounded-md ${muted ? "opacity-60" : ""}`}
                    >
                      <DateBadge date={b.date} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{b.serviceName ?? "Session"}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {b.startTime}–{endTime(b.startTime, b.durationMinutes)}
                          {b.notes ? ` · ${b.notes}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right space-y-1">
                        <SessionPill b={b} />
                        <p className="text-xs text-muted-foreground">{euro(b.price)}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </Card>

          <ClientTimeline timeline={timeline} filter={timelineFilter} onFilterChange={setTimelineFilter} />
        </div>

        {/* Right: schedule and money */}
        <div className="space-y-5 @3xl:col-start-2 @3xl:row-start-1 @5xl:col-start-3">
          <Card title="Upcoming sessions" action={<Link to="/calendar" className={linkAction}>View agenda</Link>}>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming sessions.</p>
            ) : (
              <div className="space-y-3">
                {upcoming.slice(0, 5).map((b) => (
                  <Link key={b.id} to={`/calendar?date=${b.date}`} className="flex items-center gap-3 hover:bg-accent/40 -mx-2 px-2 py-1 rounded-md">
                    <DateBadge date={b.date} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{b.serviceName ?? "Session"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(`${b.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
                        {" · "}
                        {b.startTime}–{endTime(b.startTime, b.durationMinutes)}
                      </p>
                      <div className="mt-1">
                        <StatusPill status={b.status} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card
            title={
              <>
                <Receipt className="size-4 text-brand-copper" /> Balance &amp; invoices
              </>
            }
            action={
              invoices.length > 4 ? (
                <button type="button" onClick={() => setShowAllInvoices((v) => !v)} className={linkAction}>
                  {showAllInvoices ? "Show fewer" : `View all (${invoices.length})`}
                </button>
              ) : undefined
            }
          >
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Balance due</p>
                <p className={`text-xl font-display font-semibold ${pendingTotal > 0 ? "text-brand-copper" : ""}`}>{euro(pendingTotal)}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Total paid</p>
                <p className="text-xl font-display font-semibold text-[#4C7A56]">{euro(paidTotal)}</p>
              </div>
            </div>
            {invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices.</p>
            ) : (
              <div className="space-y-2.5">
                {visibleInvoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{inv.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(inv.issueDate)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-medium">{euro(inv.total)}</span>
                      <StatusPill status={inv.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            title={
              <>
                <PackageIcon className="size-4 text-brand-copper" /> Session packages
              </>
            }
            action={<Link to={`/packages?clientId=${id}`} className={linkAction}>Manage</Link>}
          >
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
                          {p.expiresAt && ` · expires ${fmtDate(p.expiresAt)}`}
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
          </Card>

          <Card
            title={
              <>
                <Euro className="size-4 text-brand-copper" /> Payments &amp; quotes
              </>
            }
          >
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Payments ({payments.length})</summary>
              <div className="space-y-2 mt-2">
                {payments.length === 0 && <p className="text-muted-foreground">No payments recorded.</p>}
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between">
                    <p className="font-medium">{euro(p.amount)}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.method} · {fmtDate(p.paidAt)}
                    </p>
                  </div>
                ))}
              </div>
            </details>
            <details className="text-sm mt-3 pt-3 border-t border-border">
              <summary className="cursor-pointer font-medium flex items-center gap-2">
                <FileText className="size-3.5 inline text-brand-copper" /> Quotes ({quotes.length})
              </summary>
              <div className="space-y-2 mt-2">
                {quotes.length === 0 && <p className="text-muted-foreground">No quotes.</p>}
                {quotes.map((qt) => (
                  <div key={qt.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{qt.quoteNumber}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(qt.issueDate)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-medium">{euro(qt.total)}</span>
                      <StatusPill status={qt.status} />
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </Card>
        </div>
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
