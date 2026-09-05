import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { ShieldAlert, Loader2 } from "lucide-react";

type AuditEntry = {
  id: number;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: string | null;
  createdAt: string;
};

const ACTION_LABEL: Record<string, string> = {
  deleted: "Deleted",
  updated: "Updated",
  price_changed: "Price changed",
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function summarize(entry: AuditEntry): string {
  if (!entry.metadata) return "";
  try {
    const m = JSON.parse(entry.metadata);
    return Object.entries(m)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ");
  } catch {
    return "";
  }
}

export default function AuditLogPage() {
  return (
    <Protected>
      <AuditLogContent />
    </Protected>
  );
}

function AuditLogContent() {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const query = useQuery({
    queryKey: ["audit-log", page],
    queryFn: async () => {
      const res = await api["audit-log"].$get({ query: { page: String(page), pageSize: String(PAGE_SIZE) } });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to load audit log");
      return data as { entries: AuditEntry[]; total: number; page: number; pageSize: number };
    },
  });

  const entries = query.data?.entries ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
          <ShieldAlert className="size-6 text-brand-copper" /> Audit Log
        </h1>
        <p className="text-muted-foreground mt-1">Deletions and edits to bookings, packages, quotes, services and settings — {total} entries</p>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Entity</th>
                <th className="px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center">
                    <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No audit entries yet.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="border-t border-border align-top">
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(e.createdAt)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{e.actorEmail ?? "—"}</td>
                    <td className="px-4 py-3 font-medium">{ACTION_LABEL[e.action] ?? e.action}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {e.entityType}
                      {e.entityId ? ` #${e.entityId}` : ""}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[360px] truncate" title={summarize(e)}>
                      {summarize(e)}
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
