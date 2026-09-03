import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { StatusPill } from "../components/status-pill";
import { SearchInput, SortableTh, EmptyRow, StatusFilter } from "../components/data-table";
import { useSort, cmpStr, cmpDate, matchesId, applyDir, normalize, idFromQuery } from "../lib/list";
import { Link } from "wouter";
import { Trash2, Loader2, Plus, Send, CheckCircle2 } from "lucide-react";

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
  invoiceStatus: string | null;
  invoiceNumber: string | null;
};

type BookingSortKey = "date" | "client" | "service" | "status";
const bookingComparators: Record<BookingSortKey, (a: BookingItem, b: BookingItem) => number> = {
  date: (a, b) => cmpDate(`${a.date}T${a.startTime}`, `${b.date}T${b.startTime}`),
  client: (a, b) => cmpStr(a.name, b.name),
  service: (a, b) => cmpStr(a.serviceName, b.serviceName),
  status: (a, b) => cmpStr(a.status, b.status),
};

export default function BookingsPage() {
  return (
    <Protected>
      <BookingsContent />
    </Protected>
  );
}

function BookingsContent() {
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { sortKey, sortDir, toggle } = useSort<BookingSortKey>("date", "asc");

  const bookings = useQuery({
    queryKey: ["bookings"],
    queryFn: async (): Promise<{ bookings: BookingItem[] }> => {
      const res = await api.bookings.$get();
      const data = await res.json();
      return data as { bookings: BookingItem[] };
    },
  });

  const deleteBooking = useMutation({
    mutationFn: async (id: number) => (await api.bookings[":id"].$delete({ param: { id: String(id) } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["calendar-bookings"] });
      setToast("Booking deleted.");
      setTimeout(() => setToast(null), 3000);
    },
  });

  const sendInvoice = useMutation({
    mutationFn: async (invoiceId: number) => {
      const res = await api.invoices[":id"].send.$post({ param: { id: String(invoiceId) } });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to send invoice");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      setToast("Invoice emailed to client.");
      setTimeout(() => setToast(null), 3000);
    },
    onError: (err: any) => {
      setToast(err?.message ?? "Failed to send invoice.");
      setTimeout(() => setToast(null), 4000);
    },
  });

  function handleDelete(id: number, name: string) {
    if (window.confirm(`Delete booking for ${name}? This cannot be undone.`)) {
      deleteBooking.mutate(id);
    }
  }

  const allBookings = bookings.data?.bookings ?? [];
  const q = normalize(search);
  const exactId = idFromQuery(search);
  const filtered = allBookings.filter((b) => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (!q) return true;
    if (matchesId(b.id, search)) return true;
    if (b.clientId != null && matchesId(b.clientId, search)) return true;
    return normalize([b.name, b.email, b.serviceName].filter(Boolean).join(" ")).includes(q);
  });
  const sorted = [...filtered].sort((a, b) => applyDir(bookingComparators[sortKey](a, b), sortDir));

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-md text-sm font-medium bg-[#4C7A56] text-white">
          {toast}
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Bookings</h1>
          <p className="text-muted-foreground mt-1">
            Mon/Wed/Fri · Rotterdam · Tue/Thu · Amsterdam ·{" "}
            <Link to="/book" className="text-primary underline">
              public booking page
            </Link>
          </p>
        </div>
        <Link
          to="/bookings/manual"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="size-4" />
          Create Manual Booking
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by client, service or #ID…" />
        <StatusFilter
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All" },
            { value: "pending_deposit", label: "Payment pending" },
            { value: "confirmed", label: "Confirmed" },
            { value: "completed", label: "Completed" },
            { value: "no_show", label: "No-show" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
      </div>

      {bookings.isLoading ? (
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
                <SortableTh label="Client" active={sortKey === "client"} dir={sortDir} onClick={() => toggle("client")} />
                <SortableTh label="Service" active={sortKey === "service"} dir={sortDir} onClick={() => toggle("service")} />
                <SortableTh label="Date" active={sortKey === "date"} dir={sortDir} onClick={() => toggle("date")} />
                <th className="px-4 py-3 font-medium">Time</th>
                <SortableTh label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggle("status")} />
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => {
                const isExact = exactId !== null && (b.id === exactId || b.clientId === exactId);
                return (
                <tr key={b.id} className={`border-t border-border hover:bg-accent/40 transition-colors ${isExact ? "bg-primary/10" : ""}`}>
                  <td className="px-4 py-3 font-medium">
                    {b.clientId ? (
                      <Link to={`/clients/${b.clientId}`} className="hover:text-primary hover:underline">
                        {b.name}
                      </Link>
                    ) : (
                      b.name
                    )}
                    <div className="text-xs text-muted-foreground">{b.email}</div>
                  </td>
                  <td className="px-4 py-3">{b.serviceName ?? "—"}</td>
                  <td className="px-4 py-3">{new Date(`${b.date}T00:00:00`).toLocaleDateString("en-GB")}</td>
                  <td className="px-4 py-3">
                    {b.startTime}
                    {b.invoiceId && b.invoiceStatus !== "paid" && b.invoiceStatus !== "cancelled" && (
                      <button
                        onClick={() => sendInvoice.mutate(b.invoiceId!)}
                        disabled={sendInvoice.isPending && sendInvoice.variables === b.invoiceId}
                        className="ml-2 inline-flex items-center gap-1 text-xs text-brand-copper hover:underline disabled:opacity-50"
                        title={`${b.invoiceStatus === "draft" ? "Send" : "Resend"} invoice ${b.invoiceNumber ?? ""}`}
                      >
                        {sendInvoice.isPending && sendInvoice.variables === b.invoiceId ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Send className="size-3.5" />
                        )}
                        {b.invoiceStatus === "draft" ? "Send invoice" : "Resend"}
                      </button>
                    )}
                    {b.invoiceId && b.invoiceStatus === "paid" && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-[#4C7A56]" title={`Invoice ${b.invoiceNumber} paid`}>
                        <CheckCircle2 className="size-3.5" /> Paid
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={b.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(b.id, b.name)}
                      disabled={deleteBooking.isPending && deleteBooking.variables === b.id}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                      title="Delete booking"
                    >
                      {deleteBooking.isPending && deleteBooking.variables === b.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                  </td>
                </tr>
                );
              })}
              {sorted.length === 0 && <EmptyRow colSpan={7} searching={q.length > 0} noun="bookings" />}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
