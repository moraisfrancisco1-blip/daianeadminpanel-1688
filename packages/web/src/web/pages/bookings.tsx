import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { StatusPill } from "../components/status-pill";
import { Link } from "wouter";
import { Trash2, Loader2, Plus } from "lucide-react";

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

  const bookings = useQuery({
    queryKey: ["bookings"],
    queryFn: async () => (await api.bookings.$get()).json(),
  });

  const deleteBooking = useMutation({
    mutationFn: async (id: number) => (await api.bookings[":id"].$delete({ param: { id: String(id) } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      setToast("Booking deleted.");
      setTimeout(() => setToast(null), 3000);
    },
  });

  function handleDelete(id: number, name: string) {
    if (window.confirm(`Delete booking for ${name}? This cannot be undone.`)) {
      deleteBooking.mutate(id);
    }
  }

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
            Mon/Wed/Fri 10:00–18:00 · €25 deposit ·{" "}
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
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Deposit</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(bookings.data?.bookings ?? []).map((b) => (
                <tr key={b.id} className="border-t border-border hover:bg-accent/40 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    {b.name}
                    <div className="text-xs text-muted-foreground">{b.email}</div>
                  </td>
                  <td className="px-4 py-3">{b.serviceName ?? "—"}</td>
                  <td className="px-4 py-3">{b.date}</td>
                  <td className="px-4 py-3">{b.startTime}</td>
                  <td className="px-4 py-3">
                    €{b.depositAmount.toFixed(2)}{" "}
                    <span className="text-xs text-muted-foreground">({b.depositStatus})</span>
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
              ))}
              {(bookings.data?.bookings ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No bookings yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
