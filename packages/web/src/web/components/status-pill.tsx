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

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize tracking-wide",
        STYLES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
