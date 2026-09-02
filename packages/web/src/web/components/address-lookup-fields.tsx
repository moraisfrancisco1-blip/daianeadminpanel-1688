import { useState } from "react";
import { Search, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../lib/api";

export type FoundAddress = { street: string; houseNumber: string; postcode: string; city: string };

/**
 * Postcode + house number lookup (NL only, via PDOK) that fills the address
 * fields elsewhere in the form through onFound — kept separate from the
 * street/city/zip inputs since those stay editable afterwards (the client's
 * actual data always wins over what the lookup suggested).
 */
export function AddressLookupFields({ onFound }: { onFound: (address: FoundAddress) => void }) {
  const [postcode, setPostcode] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "found" | "not-found" | "error">("idle");

  async function lookup() {
    if (!postcode.trim() || !houseNumber.trim()) return;
    setState("loading");
    try {
      const res = await api["address-lookup"].$get({ query: { postcode: postcode.trim(), houseNumber: houseNumber.trim() } });
      const data = (await res.json()) as { found?: boolean; street?: string; houseNumber?: string; postcode?: string; city?: string; message?: string };
      if (!res.ok || !data.found) {
        setState("not-found");
        return;
      }
      onFound({ street: data.street!, houseNumber: data.houseNumber ?? houseNumber, postcode: data.postcode ?? postcode, city: data.city ?? "" });
      setState("found");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="rounded-md border border-dashed border-input p-3 space-y-2">
      <p className="text-xs text-muted-foreground">Preencher morada automaticamente (código postal + nº de porta, NL)</p>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <input
          value={postcode}
          onChange={(e) => {
            setPostcode(e.target.value);
            setState("idle");
          }}
          placeholder="1234 AB"
          className="h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
        <input
          value={houseNumber}
          onChange={(e) => {
            setHouseNumber(e.target.value);
            setState("idle");
          }}
          placeholder="Nº"
          className="h-10 px-3 rounded-md border border-input bg-background text-sm"
        />
        <button
          type="button"
          onClick={lookup}
          disabled={state === "loading" || !postcode.trim() || !houseNumber.trim()}
          className="h-10 px-3 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {state === "loading" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Procurar
        </button>
      </div>
      {state === "found" && (
        <p className="text-xs text-[#4C7A56] flex items-center gap-1"><CheckCircle2 className="size-3.5" /> Morada preenchida abaixo — confirma antes de guardar.</p>
      )}
      {state === "not-found" && (
        <p className="text-xs text-amber-600 flex items-center gap-1"><XCircle className="size-3.5" /> Não encontrada — preenche a morada manualmente abaixo.</p>
      )}
      {state === "error" && (
        <p className="text-xs text-destructive flex items-center gap-1"><XCircle className="size-3.5" /> Falha ao procurar — preenche a morada manualmente abaixo.</p>
      )}
    </div>
  );
}
