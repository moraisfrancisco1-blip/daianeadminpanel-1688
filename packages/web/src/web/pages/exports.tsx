import { useState } from "react";
import { Protected } from "../components/protected";
import { Button } from "../components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { downloadFile } from "../lib/download";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function ExportsPage() {
  return (
    <Protected>
      <ExportsContent />
    </Protected>
  );
}

function ExportsContent() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  async function handleDownload() {
    setDownloading(true);
    setError("");
    try {
      await downloadFile(
        `/api/exports/monthly?year=${year}&month=${month}`,
        `invoices-${year}-${String(month).padStart(2, "0")}.xlsx`,
      );
    } catch (e: any) {
      setError(e?.message ?? "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Exports for Accountant</h1>
        <p className="text-muted-foreground mt-1">Monthly Excel summary + individual invoice PDFs</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 max-w-lg space-y-4">
        <h3 className="font-medium">Monthly Excel export</h3>
        <div className="grid grid-cols-2 gap-3">
          <select
            className="h-10 px-3 rounded-md border border-input bg-background text-sm"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="number"
            className="h-10 px-3 rounded-md border border-input bg-background text-sm"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>
        <Button className="w-full" onClick={handleDownload} disabled={downloading}>
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {downloading ? "Downloading…" : "Download Excel"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Includes invoice number, client, dates, subtotal, VAT, total, status. For individual invoice PDFs, use the
          download icon on the Invoices page.
        </p>
      </div>
    </div>
  );
}
