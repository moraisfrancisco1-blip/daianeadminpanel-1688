import { cn } from "../lib/utils";

const STYLES: Record<string, string> = {
  paid: "bg-[#3F6B52]/12 text-[#3F6B52]",
  sent: "bg-[#955F27]/14 text-[#955F27]",
  draft: "bg-muted text-muted-foreground",
  overdue: "bg-[#AE4F3F]/14 text-[#AE4F3F]",
  cancelled: "bg-muted text-muted-foreground line-through",
  accepted: "bg-[#3F6B52]/12 text-[#3F6B52]",
  declined: "bg-[#AE4F3F]/14 text-[#AE4F3F]",
  pending_deposit: "bg-[#955F27]/14 text-[#955F27]",
  confirmed: "bg-[#3F6B52]/12 text-[#3F6B52]",
  no_show: "bg-[#AE4F3F]/14 text-[#AE4F3F]",
  completed: "bg-muted text-muted-foreground",
  refunded: "bg-purple-600/12 text-purple-700",
  partially_refunded: "bg-purple-400/15 text-purple-600",
};

// The underlying status values stay in English (they're the actual database
// values, shared with backend logic) — only what's shown on screen is
// translated, so a non-technical reader isn't stuck decoding English jargon.
const LABEL_PT: Record<string, string> = {
  paid: "Paga",
  sent: "Enviada",
  draft: "Rascunho",
  overdue: "Vencida",
  cancelled: "Cancelada",
  accepted: "Aceite",
  declined: "Recusada",
  pending_deposit: "Depósito pendente",
  confirmed: "Confirmada",
  no_show: "Não compareceu",
  completed: "Concluída",
  refunded: "Reembolsada",
  partially_refunded: "Parcialmente reembolsada",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize tracking-wide",
        STYLES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {LABEL_PT[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}
