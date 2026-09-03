import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Protected } from "../components/protected";
import { api } from "../lib/api";
import { Building2, Save, Loader2 } from "lucide-react";

interface CompanyDetails {
  name: string;
  address: string;
  zipCity: string;
  kvk: string;
  vat: string;
  iban: string;
  phone: string;
  paymentTermDays: number;
}

export default function SettingsPage() {
  return (
    <Protected>
      <SettingsContent />
    </Protected>
  );
}

function SettingsContent() {
  const qc = useQueryClient();
  const [form, setForm] = useState<CompanyDetails | null>(null);
  const [saved, setSaved] = useState(false);

  const companyQ = useQuery({
    queryKey: ["settings-company"],
    queryFn: async () => {
      const res = await api.settings.company.$get();
      return (await res.json()) as { company: CompanyDetails };
    },
  });

  useEffect(() => {
    if (companyQ.data?.company && !form) setForm(companyQ.data.company);
  }, [companyQ.data, form]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.settings.company.$put({ json: form } as any);
      return (await res.json()) as { company: CompanyDetails };
    },
    onSuccess: (data) => {
      qc.setQueryData(["settings-company"], data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function set<K extends keyof CompanyDetails>(key: K, value: CompanyDetails[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  if (companyQ.isLoading || !form) {
    return <div className="h-64 rounded-xl bg-muted animate-pulse max-w-2xl" />;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-brand-teal">Settings</h1>
        <p className="text-muted-foreground mt-1">Business details shown on your invoices</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          <Building2 className="size-4 text-brand-copper" /> Company / invoice details
        </h3>

        <div>
          <label className="text-xs text-muted-foreground">Business name</label>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className="w-full h-10 px-3 mt-1 rounded-md border border-input bg-background text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Address</label>
            <input
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              className="w-full h-10 px-3 mt-1 rounded-md border border-input bg-background text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Zip code / city</label>
            <input
              value={form.zipCity}
              onChange={(e) => set("zipCity", e.target.value)}
              className="w-full h-10 px-3 mt-1 rounded-md border border-input bg-background text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">KVK number</label>
            <input
              value={form.kvk}
              onChange={(e) => set("kvk", e.target.value)}
              className="w-full h-10 px-3 mt-1 rounded-md border border-input bg-background text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">VAT number</label>
            <input
              value={form.vat}
              onChange={(e) => set("vat", e.target.value)}
              className="w-full h-10 px-3 mt-1 rounded-md border border-input bg-background text-sm"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">IBAN</label>
          <input
            value={form.iban}
            onChange={(e) => set("iban", e.target.value)}
            className="w-full h-10 px-3 mt-1 rounded-md border border-input bg-background text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Phone</label>
            <input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              className="w-full h-10 px-3 mt-1 rounded-md border border-input bg-background text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Payment term (days)</label>
            <input
              type="number"
              min={0}
              value={form.paymentTermDays}
              onChange={(e) => set("paymentTermDays", Number(e.target.value))}
              className="w-full h-10 px-3 mt-1 rounded-md border border-input bg-background text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
          >
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {save.isPending ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-sm text-[#4C7A56]">Saved.</span>}
        </div>
      </div>
    </div>
  );
}
