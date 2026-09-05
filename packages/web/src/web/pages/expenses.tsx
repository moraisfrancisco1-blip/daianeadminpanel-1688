import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Plus, Trash2, X, Loader2, Upload, Sparkles, Paperclip, Camera } from "lucide-react";

type Expense = {
  id: number;
  supplier: string;
  category: string | null;
  invoiceNumber: string | null;
  issueDate: string;
  netAmount: number;
  vatAmount: number;
  vatRate: number;
  totalAmount: number;
  notes: string | null;
  attachmentUrl: string | null;
  attachmentFilename: string | null;
};

const CATEGORIES = ["Telecom", "Software", "Advertising", "Domain/Hosting", "Office", "Travel", "Other"];

const MAX_PHOTO_DIMENSION = 1800;

/**
 * Downscales a phone-camera photo before upload — an uncompressed photo can
 * be 5-10MB, which risks tripping Vercel's request body size limit. Keeps
 * the aspect ratio (unlike the avatar cropper) since this is a document.
 * PDFs are passed through untouched — they're already compact and a canvas
 * can't touch them anyway.
 */
function downscaleImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return Promise.resolve(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const img = new Image();
    reader.onload = () => {
      img.onerror = () => reject(new Error("Could not read the image."));
      img.onload = () => {
        if (img.width <= MAX_PHOTO_DIMENSION && img.height <= MAX_PHOTO_DIMENSION) {
          resolve(file);
          return;
        }
        const scale = MAX_PHOTO_DIMENSION / Math.max(img.width, img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported."));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("Could not downscale the image."));
            resolve(new File([blob], file.name, { type: "image/jpeg" }));
          },
          "image/jpeg",
          0.85,
        );
      };
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export default function ExpensesPage() {
  return (
    <Protected>
      <ExpensesContent />
    </Protected>
  );
}

function ExpensesContent() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4000);
  };

  const expensesQ = useQuery({
    queryKey: ["expenses"],
    queryFn: async (): Promise<{ expenses: Expense[] }> => (await api.expenses.$get()).json() as any,
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.expenses[":id"].$delete({ param: { id: String(id) } })).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      notify("Expense deleted.");
    },
  });

  const list = expensesQ.data?.expenses ?? [];
  const totalNet = list.reduce((s, e) => s + e.netAmount, 0);
  const totalVat = list.reduce((s, e) => s + e.vatAmount, 0);

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-md text-sm font-medium bg-[#4C7A56] text-white">{toast}</div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-brand-teal">Expenses</h1>
          <p className="text-muted-foreground mt-1">Business purchases (phone, domain, ads, etc.) — VAT here is deductible</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90"
        >
          <Plus className="size-4" /> Add expense
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs text-muted-foreground">Net total</p>
          <p className="text-2xl font-display font-semibold">€{totalNet.toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs text-muted-foreground">VAT paid (deductible)</p>
          <p className="text-2xl font-display font-semibold text-brand-copper">€{totalVat.toFixed(2)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-xs text-muted-foreground">Entries</p>
          <p className="text-2xl font-display font-semibold">{list.length}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Supplier</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Net</th>
                <th className="px-4 py-3 font-medium">VAT</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Receipt</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expensesQ.isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center">
                    <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    No expenses yet.
                  </td>
                </tr>
              ) : (
                list.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-4 py-3 text-muted-foreground">{new Date(e.issueDate).toLocaleDateString("en-GB")}</td>
                    <td className="px-4 py-3 font-medium">{e.supplier}</td>
                    <td className="px-4 py-3 text-muted-foreground">{e.category ?? "—"}</td>
                    <td className="px-4 py-3">€{e.netAmount.toFixed(2)}</td>
                    <td className="px-4 py-3">€{e.vatAmount.toFixed(2)}</td>
                    <td className="px-4 py-3 font-medium">€{e.totalAmount.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {e.attachmentUrl ? (
                        <a href={e.attachmentUrl} target="_blank" rel="noreferrer" className="text-brand-teal hover:underline inline-flex items-center gap-1">
                          <Paperclip className="size-3.5" /> View
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete the expense from ${e.supplier}?`)) remove.mutate(e.id);
                          }}
                          className="p-1.5 rounded text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && <ExpenseForm onClose={() => setShowForm(false)} onSaved={() => notify("Expense saved.")} />}
    </div>
  );
}

function ExpenseForm(props: { onClose: () => void; onSaved: () => void }) {
  const { onClose, onSaved } = props;
  const qc = useQueryClient();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [supplier, setSupplier] = useState("");
  const [category, setCategory] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [netAmount, setNetAmount] = useState("");
  const [vatAmount, setVatAmount] = useState("");
  const [vatRate, setVatRate] = useState("0.21");
  const [totalAmount, setTotalAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachmentFilename, setAttachmentFilename] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);

  const scan = useMutation({
    mutationFn: async (rawFile: File) => {
      const file = await downscaleImageIfNeeded(rawFile);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/expenses/scan", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to scan the file");
      return data as {
        attachmentUrl: string;
        attachmentFilename: string;
        extracted: {
          supplier: string | null;
          category: string | null;
          invoiceNumber: string | null;
          issueDate: string | null;
          netAmount: number | null;
          vatAmount: number | null;
          vatRate: number | null;
          totalAmount: number | null;
        } | null;
        extractError: string | null;
      };
    },
    onSuccess: (data) => {
      setAttachmentUrl(data.attachmentUrl);
      setAttachmentFilename(data.attachmentFilename);
      if (data.extracted) {
        const e = data.extracted;
        if (e.supplier) setSupplier(e.supplier);
        if (e.category) setCategory(e.category);
        if (e.invoiceNumber) setInvoiceNumber(e.invoiceNumber);
        if (e.issueDate) setIssueDate(e.issueDate);
        if (e.netAmount != null) setNetAmount(String(e.netAmount));
        if (e.vatAmount != null) setVatAmount(String(e.vatAmount));
        if (e.vatRate != null) setVatRate(String(e.vatRate));
        if (e.totalAmount != null) setTotalAmount(String(e.totalAmount));
        setScanNote("Fields auto-filled from the receipt — please check them before saving.");
      } else {
        setScanNote(data.extractError ?? "File attached. Auto-fill wasn't available — fill in the fields manually.");
      }
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.expenses.$post({
        json: {
          supplier,
          category: category || null,
          invoiceNumber: invoiceNumber || null,
          issueDate,
          netAmount: Number(netAmount) || 0,
          vatAmount: Number(vatAmount) || 0,
          vatRate: Number(vatRate) || 0,
          totalAmount: Number(totalAmount) || Number(netAmount) + Number(vatAmount),
          notes: notes || null,
          attachmentUrl,
          attachmentFilename,
        },
      } as any);
      const data = await res.json();
      if (!res.ok) throw new Error((data as { message?: string })?.message ?? "Failed to save expense");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["expenses"] });
      onSaved();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl p-6 w-full max-w-lg space-y-3 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground">
          <X className="size-4" />
        </button>
        <h2 className="font-display text-xl font-semibold">Add expense</h2>

        <div>
          {/* `capture="environment"` opens the phone's camera directly instead of a
              general photo/file picker — the closest a web page gets to "Adobe Scan".
              Desktop browsers just ignore the attribute and fall back to a file picker. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) scan.mutate(file);
              e.target.value = "";
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) scan.mutate(file);
              e.target.value = "";
            }}
          />

          {attachmentFilename ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={scan.isPending}
              className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-md border-2 border-dashed border-input text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
            >
              {scan.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Scanning…
                </>
              ) : (
                <>
                  <Paperclip className="size-4" /> {attachmentFilename} (click to replace)
                </>
              )}
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                disabled={scan.isPending}
                className="flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-md border-2 border-dashed border-input text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {scan.isPending ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
                Scan with camera
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={scan.isPending}
                className="flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-md border-2 border-dashed border-input text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
              >
                <Upload className="size-5" />
                Upload file
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-1.5">Auto-fills the fields below from the receipt — always double-check before saving.</p>
          {scanNote && (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1">
              <Sparkles className="size-3.5 shrink-0 mt-0.5" /> {scanNote}
            </p>
          )}
          {scan.isError && <p className="text-xs text-destructive mt-1.5">{(scan.error as Error).message}</p>}
        </div>

        <input
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Supplier (e.g. Vodafone)"
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
        <div className="grid grid-cols-2 gap-3">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
            <option value="">Category (optional)</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="Invoice # (optional)"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
        </div>
        <input
          type="date"
          value={issueDate}
          onChange={(e) => setIssueDate(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
        <div className="grid grid-cols-3 gap-3">
          <input
            type="number"
            step="0.01"
            value={netAmount}
            onChange={(e) => setNetAmount(e.target.value)}
            placeholder="Net (€)"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
          <input
            type="number"
            step="0.01"
            value={vatAmount}
            onChange={(e) => setVatAmount(e.target.value)}
            placeholder="VAT (€)"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
          <input
            type="number"
            step="0.01"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            placeholder="Total (€)"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
        </div>
        <select value={vatRate} onChange={(e) => setVatRate(e.target.value)} className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm">
          <option value="0.21">VAT 21%</option>
          <option value="0.09">VAT 9%</option>
          <option value="0">VAT 0%</option>
        </select>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
        />

        {save.isError && <p className="text-xs text-destructive">{(save.error as Error).message}</p>}

        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || !supplier || !netAmount || !issueDate}
          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
        >
          {save.isPending && <Loader2 className="size-4 animate-spin" />} Save expense
        </button>
      </div>
    </div>
  );
}
