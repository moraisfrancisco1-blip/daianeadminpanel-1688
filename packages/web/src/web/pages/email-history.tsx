import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { SearchInput } from "../components/data-table";
import { Mail, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type EmailRow = {
  id: number;
  createdAt: string;
  clientId: number | null;
  invoiceId: number | null;
  bookingId: number | null;
  recipientEmail: string;
  recipientName: string | null;
  type: string;
  subject: string;
  status: string;
  providerMessageId: string | null;
  error: string | null;
  provider: string | null;
  invoiceNumber: string | null;
  clientName: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  invoice: "Invoice",
  payment_link: "Payment Link",
  booking_confirmation: "Booking Confirmation",
  reminder: "Reminder",
  cancellation: "Cancellation",
  quote: "Quote",
  package: "Package",
  other: "Other",
};

const EMAIL_TYPES = ["invoice", "payment_link", "booking_confirmation", "reminder", "cancellation", "quote", "package", "other"];

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function EmailHistoryPage() {
  return (
    <Protected>
      <EmailHistoryContent />
    </Protected>
  );
}

function EmailHistoryContent() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 25;

  const query = useQuery({
    queryKey: ["emails", search, type, status, from, to, page],
    queryFn: async () => {
      const res = await api.emails.$get({
        query: {
          q: search || undefined,
          type,
          status,
          from: from || undefined,
          to: to || undefined,
          page: String(page),
          pageSize: String(PAGE_SIZE),
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to load emails");
      return data as { emails: EmailRow[]; total: number; page: number; pageSize: number };
    },
  });

  const emails = query.data?.emails ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resetPage = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Email History</h1>
          <p className="text-muted-foreground mt-1">{total} emails</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <SearchInput value={search} onChange={(v) => resetPage(() => setSearch(v))} placeholder="Search by recipient, client, invoice number, booking ID…" />
        </div>
        <select value={type} onChange={(e) => resetPage(() => setType(e.target.value))} className="h-10 px-3 rounded-md border border-input bg-background text-sm">
          <option value="all">All types</option>
          {EMAIL_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t] ?? t}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => resetPage(() => setStatus(e.target.value))} className="h-10 px-3 rounded-md border border-input bg-background text-sm">
          <option value="all">All status</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
        <input type="date" value={from} onChange={(e) => resetPage(() => setFrom(e.target.value))} className="h-10 px-3 rounded-md border border-input bg-background text-sm" title="From date" />
        <input type="date" value={to} onChange={(e) => resetPage(() => setTo(e.target.value))} className="h-10 px-3 rounded-md border border-input bg-background text-sm" title="To date" />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Recipient</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Booking</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center">
                    <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : emails.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    No emails found.
                  </td>
                </tr>
              ) : (
                emails.map((e) => (
                  <tr key={e.id} className="border-t border-border hover:bg-accent/40 transition-colors align-top">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(e.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-medium">
                        <Mail className="size-3.5" /> {TYPE_LABEL[e.type] ?? e.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{e.recipientName ?? e.recipientEmail}</p>
                      <p className="text-xs text-muted-foreground">{e.recipientName ? e.recipientEmail : ""}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{e.clientName ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{e.invoiceNumber ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{e.bookingId ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[220px] truncate" title={e.subject}>
                      {e.subject}
                    </td>
                    <td className="px-4 py-3">
                      {e.status === "sent" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#4C7A56]">
                          <CheckCircle2 className="size-3.5" /> SENT
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                          <XCircle className="size-3.5" /> FAILED
                        </span>
                      )}
                      {e.status === "failed" && e.error && <p className="text-xs text-destructive mt-1 max-w-[200px]">{e.error}</p>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-md border border-input hover:bg-accent disabled:opacity-40">
            Prev
          </button>
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 rounded-md border border-input hover:bg-accent disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  );
}

