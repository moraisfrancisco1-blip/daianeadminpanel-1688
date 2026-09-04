import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Link, useLocation } from "wouter";
import { ChevronLeft, ChevronRight, Plus, Lock, X, Loader2, Trash2, Link2, Copy, ExternalLink, Send, AlertTriangle, FileText, HeartPulse } from "lucide-react";

const FAR_DATE_WARNING_DAYS = 15;

/** How many days a YYYY-MM-DD date is from today (negative = in the past). */
function daysFromToday(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

type BookingItem = {
  id: number;
  clientId: number | null;
  name: string;
  email: string;
  phone: string | null;
  serviceId: number | null;
  serviceName: string | null;
  date: string;
  startTime: string;
  status: string;
  depositAmount: number;
  depositStatus: string;
  payFullNow: boolean;
  invoiceId: number | null;
  notes: string | null;
};

type BlockedSlot = { id: number; date: string; startTime: string; endTime: string; reason: string | null };
type Service = { id: number; name: string; durationMinutes: number; price: number };

const HOUR_START = 8;
const HOUR_END = 19;
const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-emerald-100 text-emerald-900 border-emerald-300",
  pending_deposit: "bg-brand-bronze text-white border-brand-bronze",
  completed: "bg-emerald-200 text-emerald-900 border-emerald-400",
  cancelled: "bg-neutral-400 text-white border-neutral-400",
  no_show: "bg-neutral-400 text-white border-neutral-400",
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmado",
  pending_deposit: "Pagamento pendente",
  completed: "Concluído",
  cancelled: "Cancelada",
  no_show: "Não compareceu",
};

// Recurring weekly blocks (mirror of backend WEEKLY_SCHEDULE).
const WEEKLY_BLOCKS: Record<number, { start: string; end: string }[]> = {
  1: [{ start: "09:00", end: "10:00" }],
  3: [{ start: "09:00", end: "11:00" }],
  5: [{ start: "10:00", end: "11:00" }],
};

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function startOfWeek(d: Date): Date {
  const diff = d.getDay() === 0 ? 6 : d.getDay() - 1;
  return addDays(d, -diff);
}
function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m ?? 0);
}
function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
// Tuesdays and Thursdays are reserved for Amsterdam-location sessions only.
function isAmsterdamOnlyDay(day: Date): boolean {
  const dow = day.getDay();
  return dow === 2 || dow === 4;
}

export default function CalendarPage() {
  return (
    <Protected>
      <CalendarContent />
    </Protected>
  );
}

function CalendarContent() {
  const qc = useQueryClient();
  const [, navigateTo] = useLocation();
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const initialDateParam = new URLSearchParams(window.location.search).get("date");
  const [cursor, setCursor] = useState(() =>
    initialDateParam ? new Date(`${initialDateParam}T12:00:00`) : new Date(),
  );
  const [selectedBooking, setSelectedBooking] = useState<BookingItem | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const bookingsQ = useQuery({
    queryKey: ["calendar-bookings"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<BookingItem[]> => {
      const res = await api.bookings.$get();
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to load bookings");
      return (data as { bookings: BookingItem[] }).bookings;
    },
  });

  const servicesQ = useQuery({
    queryKey: ["calendar-services"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<Service[]> => {
      const res = await api.services.$get();
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to load services");
      return (data as { services: Service[] }).services;
    },
  });

  const range = useMemo(() => {
    if (view === "month") {
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const startMonday = startOfWeek(start);
      return { from: toISODate(startMonday), to: toISODate(addDays(startMonday, 41)) };
    }
    const start = view === "day" ? cursor : startOfWeek(cursor);
    const end = view === "day" ? cursor : addDays(start, 6);
    return { from: toISODate(start), to: toISODate(end) };
  }, [view, cursor]);

  const blockedQ = useQuery({
    queryKey: ["blocked", range.from, range.to],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<BlockedSlot[]> => {
      const res = await api.bookings.blocked.$get({ query: { from: range.from, to: range.to } });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to load blocked slots");
      return (data as { blocked: BlockedSlot[] }).blocked;
    },
  });

  const durationMap = useMemo(() => {
    const m = new Map<number, number>();
    const list = Array.isArray(servicesQ.data) ? servicesQ.data : [];
    for (const s of list) m.set(s.id, s.durationMinutes);
    return m;
  }, [servicesQ.data]);

  const updateBooking = useMutation({
    mutationFn: async (p: { id: number; data: any }) =>
      // PUT /bookings/:id has no zod validator on the backend, so the Hono RPC
      // client can't infer a body type for it (only the `:id` param) — cast is
      // required here, not a sign the request itself is malformed.
      (await api.bookings[":id"].$put({ param: { id: String(p.id) }, json: p.data } as any)).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["calendar-bookings"] });
      qc.invalidateQueries({ queryKey: ["dashboard-today"] });
      setSelectedBooking(null);
      notify("Reserva atualizada.");
    },
    onError: (e: any) => notify(e?.message ?? "Erro ao atualizar."),
  });

  const deleteBooking = useMutation({
    mutationFn: async (id: number) => (await api.bookings[":id"].$delete({ param: { id: String(id) } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["calendar-bookings"] });
      setSelectedBooking(null);
      notify("Reserva eliminada.");
    },
  });

  const createBlock = useMutation({
    mutationFn: async (data: { date: string; startTime: string; endTime: string; reason?: string }) =>
      (await api.bookings.blocked.$post({ json: data })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blocked"] });
      setShowBlockModal(false);
      notify("Horário bloqueado.");
    },
  });

  const deleteBlock = useMutation({
    mutationFn: async (id: number) =>
      (await api.bookings.blocked[":id"].$delete({ param: { id: String(id) } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blocked"] });
      notify("Bloqueio removido.");
    },
  });

  const navigate = (dir: -1 | 1) => {
    if (view === "month") {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    } else {
      setCursor((c) => addDays(c, view === "day" ? dir : dir * 7));
    }
  };

  const title = useMemo(() => {
    if (view === "month") return cursor.toLocaleString("en-GB", { month: "long", year: "numeric" });
    if (view === "day")
      return cursor.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    const s = startOfWeek(cursor);
    const e = addDays(s, 6);
    return `${s.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${e.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  }, [view, cursor]);

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-md text-sm font-medium bg-[#4C7A56] text-white">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-brand-teal">Agenda</h1>
          <p className="text-muted-foreground mt-1">{title}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowBlockModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent"
          >
            <Lock className="size-4" /> Bloquear horário
          </button>
          <Link
            to="/bookings/manual"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90"
          >
            <Plus className="size-4" /> Novo booking
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} className="p-2 rounded-md border border-input hover:bg-accent">
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent"
          >
            Hoje
          </button>
          <button onClick={() => navigate(1)} className="p-2 rounded-md border border-input hover:bg-accent">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {(["day", "week", "month"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm font-medium capitalize ${view === v ? "bg-brand-teal text-white" : "hover:bg-accent"}`}
            >
              {v === "day" ? "Dia" : v === "week" ? "Semana" : "Mês"}
            </button>
          ))}
        </div>
      </div>

      {bookingsQ.isLoading || servicesQ.isLoading ? (
        <div className="h-96 rounded-xl bg-muted animate-pulse" />
      ) : view === "month" ? (
        <MonthView
          cursor={cursor}
          bookings={bookingsQ.data ?? []}
          blocked={blockedQ.data ?? []}
          onSelectDay={(d) => {
            setCursor(d);
            setView("day");
          }}
        />
      ) : (
        <TimeGrid
          view={view}
          cursor={cursor}
          bookings={bookingsQ.data ?? []}
          blocked={blockedQ.data ?? []}
          durationMap={durationMap}
          onSelectBooking={setSelectedBooking}
          onDeleteBlock={deleteBlock.mutate}
          onCreateBooking={(date, time) => navigateTo(`/bookings/manual?date=${date}&time=${time}`)}
        />
      )}

      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          services={Array.isArray(servicesQ.data) ? servicesQ.data : []}
          saving={updateBooking.isPending}
          onClose={() => setSelectedBooking(null)}
          onSave={(data) => updateBooking.mutate({ id: selectedBooking.id, data })}
          onDelete={() => {
            if (window.confirm(`Eliminar reserva de ${selectedBooking.name}?`)) deleteBooking.mutate(selectedBooking.id);
          }}
        />
      )}

      {showBlockModal && (
        <BlockSlotModal defaultDate={cursor} onClose={() => setShowBlockModal(false)} onSave={createBlock.mutate} />
      )}
    </div>
  );
}

function TimeGrid(props: {
  view: "day" | "week";
  cursor: Date;
  bookings: BookingItem[];
  blocked: BlockedSlot[];
  durationMap: Map<number, number>;
  onSelectBooking: (b: BookingItem) => void;
  onDeleteBlock: (id: number) => void;
  onCreateBooking: (date: string, time: string) => void;
}) {
  const { view, cursor, bookings, blocked, durationMap, onSelectBooking, onDeleteBlock, onCreateBooking } = props;
  const days = view === "day" ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i));

  const top = (t: string) => ((timeToMin(t) - HOUR_START * 60) / 60) * HOUR_HEIGHT;
  const height = (mins: number) => Math.max((mins / 60) * HOUR_HEIGHT, 22);

  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="flex">
          <div className="w-12 shrink-0" />
          {days.map((day) => {
            const iso = toISODate(day);
            const isToday = iso === toISODate(new Date());
            const amsterdamOnly = isAmsterdamOnlyDay(day);
            return (
              <div
                key={iso}
                className={`flex-1 min-w-[90px] border-l border-b px-2 py-2 text-center ${
                  isToday ? "bg-brand-cream" : amsterdamOnly ? "bg-pink-100" : ""
                }`}
                title={amsterdamOnly ? "Só para clientes de Amsterdão" : undefined}
              >
                <p className="text-xs font-medium">{day.toLocaleDateString("en-GB", { weekday: "short" })}</p>
                <p className={`text-lg font-display ${isToday ? "text-brand-copper" : ""}`}>{day.getDate()}</p>
                {amsterdamOnly && <p className="text-[9px] text-pink-700 font-medium">Amsterdão</p>}
              </div>
            );
          })}
        </div>
        <div className="flex">
          <div className="w-12 shrink-0">
            {HOURS.map((h) => (
              <div key={h} className="text-[10px] text-muted-foreground text-right pr-1 -translate-y-1.5" style={{ height: HOUR_HEIGHT }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((day) => {
            const iso = toISODate(day);
            const dayBookings = bookings.filter((b) => b.date === iso);
            const dayBlocked = blocked.filter((b) => b.date === iso);
            const weeklyBlocks = WEEKLY_BLOCKS[day.getDay()] ?? [];
            const amsterdamOnly = isAmsterdamOnlyDay(day);
            return (
              <div
                key={iso}
                className={`flex-1 min-w-[90px] border-l relative ${amsterdamOnly ? "bg-pink-50" : ""}`}
                style={{ height: HOURS.length * HOUR_HEIGHT }}
                onDoubleClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const mins = HOUR_START * 60 + (y / HOUR_HEIGHT) * 60;
                  const snapped = Math.floor(mins / 15) * 15;
                  onCreateBooking(iso, minToTime(snapped));
                }}
              >
                {HOURS.map((h) => (
                  <div key={h} className="border-b border-border/40" style={{ height: HOUR_HEIGHT }} />
                ))}
                {weeklyBlocks.map((wb, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 bg-neutral-200/70 border border-dashed border-neutral-300"
                    style={{ top: top(wb.start), height: height(timeToMin(wb.end) - timeToMin(wb.start)) }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  />
                ))}
                {dayBlocked.map((blk) => (
                  <button
                    key={blk.id}
                    onClick={() => onDeleteBlock(blk.id)}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className="absolute left-0.5 right-0.5 rounded bg-neutral-300/90 border border-neutral-400 px-1 text-left overflow-hidden"
                    style={{ top: top(blk.startTime), height: height(timeToMin(blk.endTime) - timeToMin(blk.startTime)) }}
                    title={`Bloqueado ${blk.startTime}–${blk.endTime}${blk.reason ? " · " + blk.reason : ""}`}
                  >
                    <span className="text-[10px] text-neutral-700 truncate block">
                      Bloq. {blk.startTime}
                    </span>
                  </button>
                ))}
                {dayBookings.map((b) => {
                  const dur = durationMap.get(b.serviceId ?? -1) ?? 60;
                  const isCancelled = b.status === "cancelled";
                  const isNoShow = b.status === "no_show";
                  const style = STATUS_STYLES[b.status] ?? "bg-neutral-500 text-white border-neutral-500";
                  return (
                    <button
                      key={b.id}
                      onClick={() => onSelectBooking(b)}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="absolute left-0.5 right-0.5 rounded border overflow-hidden shadow-sm text-left"
                      style={{ top: top(b.startTime), height: height(dur) }}
                    >
                      <div className={`absolute inset-0 ${style} ${isCancelled ? "opacity-40" : ""}`} />
                      <div className="relative px-1.5 py-1">
                        {isCancelled && <p className="text-[11px] font-bold text-red-600 truncate">Cancelada</p>}
                        {isNoShow && <p className="text-[11px] font-bold text-amber-500 truncate">Não compareceu</p>}
                        {(isCancelled || isNoShow) && (
                          <p className="text-[10px] text-white/90 truncate">
                            {b.startTime} · {b.name}
                          </p>
                        )}
                        {!isCancelled && !isNoShow && (
                          <>
                            <p className="text-[11px] font-semibold truncate">
                              {b.startTime} · {b.name}
                            </p>
                            {dur >= 45 && <p className="text-[10px] opacity-90 truncate">{b.serviceName}</p>}
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthView(props: { cursor: Date; bookings: BookingItem[]; blocked: BlockedSlot[]; onSelectDay: (d: Date) => void }) {
  const { cursor, bookings, blocked, onSelectDay } = props;
  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const todayIso = toISODate(new Date());

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="grid grid-cols-7 border-b">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-2 py-2 text-xs font-medium text-center text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const iso = toISODate(day);
          const inMonth = day.getMonth() === cursor.getMonth();
          const count = bookings.filter((b) => b.date === iso).length;
          const hasBlock = blocked.some((b) => b.date === iso);
          const isToday = iso === todayIso;
          return (
            <button
              key={iso}
              onClick={() => onSelectDay(day)}
              className={`min-h-[80px] border-b border-l p-1.5 text-left align-top transition-colors hover:bg-accent/40 ${
                inMonth ? "" : "bg-muted/40"
              } ${isToday ? "ring-2 ring-inset ring-brand-copper" : ""}`}
            >
              <span className={`text-sm ${isToday ? "font-bold text-brand-copper" : inMonth ? "" : "text-muted-foreground"}`}>
                {day.getDate()}
              </span>
              {count > 0 && (
                <div className="mt-1">
                  <span className="inline-block text-[10px] bg-brand-teal text-white rounded px-1">
                    {count} sessão{count > 1 ? "ões" : ""}
                  </span>
                </div>
              )}
              {hasBlock && (
                <div className="mt-0.5">
                  <span className="inline-block text-[10px] bg-neutral-300 text-neutral-700 rounded px-1">bloqueio</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BookingDetailModal(props: {
  booking: BookingItem;
  services: Service[];
  saving: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  onDelete: () => void;
}) {
  const { booking, services, saving, onClose, onSave, onDelete } = props;
  const [name, setName] = useState(booking.name);
  const [email, setEmail] = useState(booking.email);
  const [phone, setPhone] = useState(booking.phone ?? "");
  const [serviceId, setServiceId] = useState(booking.serviceId ?? services[0]?.id ?? 0);
  const [date, setDate] = useState(booking.date);
  const [startTime, setStartTime] = useState(booking.startTime);
  const [status, setStatus] = useState(booking.status);
  const [sessionNotes, setSessionNotes] = useState(booking.notes ?? "");
  const [paymentLinkOpen, setPaymentLinkOpen] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [sendInvoiceLoading, setSendInvoiceLoading] = useState(false);
  const [sendInvoiceMsg, setSendInvoiceMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [generatedInvoice, setGeneratedInvoice] = useState<{ id: number; invoiceNumber: string; status: string; total: number } | null>(
    null,
  );
  const [generateInvoiceLoading, setGenerateInvoiceLoading] = useState(false);
  const [generateInvoiceError, setGenerateInvoiceError] = useState<string | null>(null);
  const effectiveInvoiceId = booking.invoiceId ?? generatedInvoice?.id ?? null;

  async function generateInvoice() {
    setGenerateInvoiceLoading(true);
    setGenerateInvoiceError(null);
    try {
      const res = await fetch(`/api/bookings/${booking.id}/generate-invoice`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to generate invoice");
      setGeneratedInvoice(data.invoice);
    } catch (e: any) {
      setGenerateInvoiceError(e?.message ?? "Failed to generate invoice.");
    } finally {
      setGenerateInvoiceLoading(false);
    }
  }

  async function sendInvoiceEmail() {
    if (!effectiveInvoiceId) return;
    setSendInvoiceLoading(true);
    setSendInvoiceMsg(null);
    try {
      const res = await fetch(`/api/invoices/${effectiveInvoiceId}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to send invoice");
      setSendInvoiceMsg({ ok: true, text: "Invoice emailed to the client." });
    } catch (e: any) {
      setSendInvoiceMsg({ ok: false, text: e?.message ?? "Failed to send invoice." });
    } finally {
      setSendInvoiceLoading(false);
    }
  }

  const invoiceQ = useQuery({
    queryKey: ["invoice", booking.invoiceId],
    queryFn: async () => {
      if (!booking.invoiceId) return null;
      const res = await fetch(`/api/invoices/${booking.invoiceId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.invoice as { id: number; invoiceNumber: string; status: string; total: number };
    },
    enabled: !!booking.invoiceId,
  });
  const effectiveInvoice = invoiceQ.data ?? generatedInvoice;

  // Read-only reference: the client's standing clinical notes (tension areas,
  // contraindications, history) — useful context while reviewing this session.
  const clinicalNotesQ = useQuery({
    queryKey: ["client-clinical-notes", booking.clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${booking.clientId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return (data.client?.clinicalNotes as string | null) ?? null;
    },
    enabled: !!booking.clientId,
  });

  async function requestPaymentLink() {
    if (!effectiveInvoiceId) return;
    setCheckoutUrl(null);
    setCheckoutLoading(true);
    setPaymentLinkOpen(true);
    try {
      const res = await fetch(`/api/invoices/${effectiveInvoiceId}/checkout`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to create payment link");
      setCheckoutUrl((data as { checkoutUrl?: string })?.checkoutUrl ?? null);
    } catch {
      setCheckoutUrl(null);
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function emailPaymentLink() {
    if (!effectiveInvoiceId) return;
    try {
      const res = await fetch(`/api/invoices/${effectiveInvoiceId}/send-payment-link`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to send payment link");
      setSendInvoiceMsg({ ok: true, text: "Payment link emailed to the client." });
    } catch (e: any) {
      setSendInvoiceMsg({ ok: false, text: e?.message ?? "Failed to send payment link." });
    } finally {
      setPaymentLinkOpen(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl p-6 w-full max-w-md space-y-4 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground">
          <X className="size-4" />
        </button>
        <h2 className="font-display text-xl font-semibold">Detalhes da reserva</h2>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">Cliente</p>
            {booking.clientId ? (
              <Link to={`/clients/${booking.clientId}`} className="font-medium text-brand-copper hover:underline">
                {booking.name}
              </Link>
            ) : (
              <p className="font-medium">{booking.name}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Email</p>
            <p className="truncate">{booking.email}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Telefone</p>
            <p>{booking.phone ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Serviço</p>
            <p>{booking.serviceName ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estado</p>
            <p>{STATUS_LABEL[booking.status] ?? booking.status}</p>
          </div>
          {clinicalNotesQ.data && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <HeartPulse className="size-3" /> Notas clínicas (cliente)
              </p>
              <p className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md px-2 py-1.5 mt-1">{clinicalNotesQ.data}</p>
            </div>
          )}
        </div>

        <div className="border-t pt-4 space-y-3">
          <h3 className="text-sm font-medium">Editar / reagendar</h3>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Telefone"
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            />
          </div>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(Number(e.target.value))}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          >
            {[...services]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes} min)
                </option>
              ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            />
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            />
          </div>
          {date && Math.abs(daysFromToday(date)) > FAR_DATE_WARNING_DAYS && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle className="size-3.5 shrink-0" />
              {new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              {" — "}
              {daysFromToday(date) > 0 ? "isto é daqui a" : "isto foi há"} {Math.abs(daysFromToday(date))} dias. Confirma que é a data certa.
            </p>
          )}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          >
            <option value="confirmed">Confirmado</option>
            <option value="pending_deposit">Pagamento pendente</option>
            <option value="completed">Concluído</option>
            <option value="cancelled">Cancelada</option>
            <option value="no_show">Não compareceu</option>
          </select>
          <div>
            <label className="text-xs text-muted-foreground">Notas desta sessão</label>
            <textarea
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
              placeholder="Algo a lembrar sobre esta sessão em particular…"
              rows={3}
              className="w-full px-3 py-2 mt-1 rounded-md border border-input bg-background text-sm resize-none"
            />
          </div>
        </div>

        {!effectiveInvoiceId && (
          <div className="border-t pt-3 space-y-2">
            <button
              type="button"
              onClick={generateInvoice}
              disabled={generateInvoiceLoading}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
            >
              {generateInvoiceLoading ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              Generate invoice
            </button>
            {generateInvoiceError && <p className="text-sm text-destructive">{generateInvoiceError}</p>}
          </div>
        )}

        {effectiveInvoice && (
          <div className="border-t pt-3 space-y-2">
            <button
              type="button"
              onClick={sendInvoiceEmail}
              disabled={sendInvoiceLoading}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
            >
              {sendInvoiceLoading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send Invoice - {effectiveInvoice.invoiceNumber}
            </button>
            {sendInvoiceMsg && (
              <p className={`text-sm ${sendInvoiceMsg.ok ? "text-[#4C7A56]" : "text-destructive"}`}>{sendInvoiceMsg.text}</p>
            )}
          </div>
        )}

        {effectiveInvoice && effectiveInvoice.status !== "paid" && effectiveInvoice.status !== "cancelled" && (
          <div className="border-t pt-3">
            <button
              type="button"
              onClick={requestPaymentLink}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent"
            >
              <Link2 className="size-4" /> Send Payment Link · Invoice {effectiveInvoice.invoiceNumber}
            </button>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-destructive text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="size-4" /> Eliminar
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent">
            Cancelar
          </button>
          <button
            onClick={() => onSave({ name, email, phone: phone || null, serviceId, date, startTime, status, notes: sessionNotes || null })}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" />} Guardar
          </button>
        </div>
      </div>
      </div>

      {paymentLinkOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-card rounded-xl p-6 w-full max-w-md space-y-4 relative">
            <button onClick={() => setPaymentLinkOpen(false)} className="absolute top-4 right-4 text-muted-foreground">
              <X className="size-4" />
            </button>
            <h2 className="font-display text-xl font-semibold">Send Payment Link</h2>
            <p className="text-sm text-muted-foreground">
              Invoice <strong>{effectiveInvoice?.invoiceNumber}</strong> — €{(effectiveInvoice?.total ?? 0).toFixed(2)}
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
                    onClick={() => navigator.clipboard?.writeText(checkoutUrl)}
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
                  onClick={emailPaymentLink}
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
    </>
  );
}

function BlockSlotModal(props: {
  defaultDate: Date;
  onClose: () => void;
  onSave: (data: { date: string; startTime: string; endTime: string; reason?: string }) => void;
}) {
  const { defaultDate, onClose, onSave } = props;
  const [date, setDate] = useState(toISODate(defaultDate));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl p-6 w-full max-w-sm space-y-4 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground">
          <X className="size-4" />
        </button>
        <h2 className="font-display text-xl font-semibold">Bloquear horário</h2>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Início</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Fim</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            />
          </div>
        </div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (opcional)"
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-3 py-2 rounded-md text-sm font-medium border border-input hover:bg-accent">
            Cancelar
          </button>
          <button
            onClick={() => onSave({ date, startTime, endTime, reason: reason || undefined })}
            className="px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90"
          >
            Bloquear
          </button>
        </div>
      </div>
    </div>
  );
}





