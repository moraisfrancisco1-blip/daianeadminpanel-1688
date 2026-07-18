import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { RefreshCw, Copy } from "lucide-react";
import { useState } from "react";

export default function RemindersPage() {
  return (
    <Protected>
      <RemindersContent />
    </Protected>
  );
}

function RemindersContent() {
  const [copied, setCopied] = useState(false);
  const qc = useQueryClient();
  const overdue = useQuery({
    queryKey: ["overdue"],
    queryFn: async () => (await api.reminders.overdue.$get()).json(),
  });

  const runCheck = useMutation({
    mutationFn: async () => (await api.reminders.run.$post()).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overdue"] }),
  });

  const webhookUrl = `${window.location.origin}/api/reminders/run`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Payment Reminders</h1>
          <p className="text-muted-foreground mt-1">Auto-sent 10 days after an invoice's due date</p>
        </div>
        <Button onClick={() => runCheck.mutate()} disabled={runCheck.isPending}>
          <RefreshCw className={`size-4 ${runCheck.isPending ? "animate-spin" : ""}`} /> Run check now
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-medium mb-1">Fully automated (recommended)</h3>
        <p className="text-sm text-muted-foreground mb-3">
          This app checks for overdue invoices every time you open the dashboard. For true unattended automation
          (even on days you don't log in), add a free scheduled call to this URL once a day using{" "}
          <a href="https://cron-job.org" target="_blank" rel="noreferrer" className="text-primary underline">
            cron-job.org
          </a>{" "}
          (method: POST):
        </p>
        <div className="flex items-center gap-2 bg-secondary/50 rounded-md px-3 py-2 text-xs font-mono">
          <span className="flex-1 truncate">{webhookUrl}</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(webhookUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="text-muted-foreground hover:text-primary"
          >
            <Copy className="size-4" />
          </button>
        </div>
        {copied && <p className="text-xs text-primary mt-1">Copied!</p>}
      </div>

      {overdue.isLoading ? (
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Invoice #</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Due date</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Reminders sent</th>
              </tr>
            </thead>
            <tbody>
              {(overdue.data?.overdue ?? []).map((inv) => (
                <tr key={inv.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3">{inv.clientName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(inv.dueDate).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3 font-medium">€{inv.total.toFixed(2)}</td>
                  <td className="px-4 py-3">{inv.reminderCount}</td>
                </tr>
              ))}
              {(overdue.data?.overdue ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No overdue invoices. 🎉
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
