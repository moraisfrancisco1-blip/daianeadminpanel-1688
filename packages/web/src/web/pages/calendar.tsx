import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Link } from "wouter";
import { ChevronLeft, ChevronRight, Plus, Lock, X, Loader2, Trash2 } from "lucide-react";

type BookingItem = {
  id: number;
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
};

type BlockedSlot = { id: number; date: string; startTime: string; endTime: string; reason: string | null };
type Service = { id: number; name: string; durationMinutes: number; price: number };

const HOUR_START = 8;
const HOUR_END = 19;
const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-brand-teal text-white border-brand-teal",
  pending_deposit: "bg-brand-bronze text-white border-brand-bronze",
  completed: "bg-[#4C7A56] text-white border-[#4C7A56]",
  cancelled: "bg-neutral-400 text-white border-neutral-400 line-through",
  no_show: "bg-neutral-600 text-white border-neutral-600",
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmado",
  pending_deposit: "Depósito pendente",
  completed: "Concluído",
  cancelled: "Cancelado",
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

export default function CalendarPage() {
  return (
    <Protected>
      <CalendarContent />
    </Protected>
  );
}

function CalendarContent() {
  const qc = useQueryClient();
  const [view, setView] = useState<"day" | "week" | "month">("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedBooking, setSelectedBooking] = useState<BookingItem | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const bookingsQ = useQuery({
    queryKey: ["bookings"],
    queryFn: async (): Promise<BookingItem[]> => {
      const res = await api.bookings.$get();
      const data = (await res.json()) as { bookings: BookingItem[] };
      return data.bookings;
    },
  });

  const servicesQ = useQuery({
    queryKey: ["services"],
    queryFn: async (): Promise<Service[]> => {
      const res = await api.services.$get();
      const data = (await res.json()) as { services: Service[] };
      return data.services;
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
    queryFn: async (): Promise<BlockedSlot[]> => {
      const res = await api.bookings.blocked.$get({ query: { from: range.from, to: range.to } });
      const data = (await res.json()) as { blocked: BlockedSlot[] };
      return data.blocked;
    },
  });

  const durationMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of servicesQ.data ?? []) m.set(s.id, s.durationMinutes);
    return m;
  }, [servicesQ.data]);

  const updateBooking = useMutation({
    mutationFn: async (p: { id: number; data: any }) =>
      (await api.bookings[":id"].$put({ param: { id: String(p.id) }, json: p.data })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
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
        />
      )}

      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          services={servicesQ.data ?? []}
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
}) {
  const { view, cursor, bookings, blocked, durationMap, onSelectBooking, onDeleteBlock } = props;
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
            return (
              <div key={iso} className={`flex-1 min-w-[90px] border-l border-b px-2 py-2 text-center ${isToday ? "bg-brand-cream" : ""}`}>
                <p className="text-xs font-medium">{day.toLocaleDateString("en-GB", { weekday: "short" })}</p>
                <p className={`text-lg font-display ${isToday ? "text-brand-copper" : ""}`}>{day.getDate()}</p>
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
            return (
              <div key={iso} className="flex-1 min-w-[90px] border-l relative" style={{ height: HOURS.length * HOUR_HEIGHT }}>
                {HOURS.map((h) => (
                  <div key={h} className="border-b border-border/40" style={{ height: HOUR_HEIGHT }} />
                ))}
                {weeklyBlocks.map((wb, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 bg-neutral-200/70 border border-dashed border-neutral-300"
                    style={{ top: top(wb.start), height: height(timeToMin(wb.end) - timeToMin(wb.start)) }}
                  />
                ))}
                {dayBlocked.map((blk) => (
                  <button
                    key={blk.id}
                    onClick={() => onDeleteBlock(blk.id)}
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
                  const style = STATUS_STYLES[b.status] ?? "bg-neutral-500 text-white border-neutral-500";
                  return (
                    <button
                      key={b.id}
                      onClick={() => onSelectBooking(b)}
                      className={`absolute left-0.5 right-0.5 rounded border px-1.5 py-1 text-left overflow-hidden shadow-sm ${style}`}
                      style={{ top: top(b.startTime), height: height(dur) }}
                    >
                      <p className="text-[11px] font-semibold truncate">
                        {b.startTime} · {b.name}
                      </p>
                      {dur >= 45 && <p className="text-[10px] opacity-90 truncate">{b.serviceName}</p>}
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

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl p-6 w-full max-w-md space-y-4 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground">
          <X className="size-4" />
        </button>
        <h2 className="font-display text-xl font-semibold">Detalhes da reserva</h2>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">Cliente</p>
            <p className="font-medium">{booking.name}</p>
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
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">Depósito</p>
            <p>
              €{booking.depositAmount.toFixed(2)} ({booking.depositStatus})
            </p>
          </div>
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
            {services.map((s) => (
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
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          >
            <option value="confirmed">Confirmado</option>
            <option value="pending_deposit">Depósito pendente</option>
            <option value="completed">Concluído</option>
            <option value="cancelled">Cancelado</option>
            <option value="no_show">Não compareceu</option>
          </select>
        </div>

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
            onClick={() => onSave({ name, email, phone: phone || null, serviceId, date, startTime, status })}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" />} Guardar
          </button>
        </div>
      </div>
    </div>
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





