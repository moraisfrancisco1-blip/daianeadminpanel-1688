import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import type { SortDir } from "../lib/list";

export function SearchInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative max-w-sm">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder ?? "Search…"}
        className="w-full h-10 pl-9 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

export function SortableTh(props: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  const align = props.align === "right" ? "text-right" : "text-left";
  return (
    <th className={`px-4 py-3 font-medium ${align}`}>
      <button
        type="button"
        onClick={props.onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${props.active ? "text-foreground" : ""}`}
        title={`Sort by ${props.label}`}
      >
        {props.label}
        {props.active ? (
          props.dir === "asc" ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )
        ) : (
          <ArrowUpDown className="size-3.5 opacity-40" />
        )}
      </button>
    </th>
  );
}

export function EmptyRow(props: { colSpan: number; searching: boolean; noun: string }) {
  return (
    <tr>
      <td colSpan={props.colSpan} className="px-4 py-8 text-center text-muted-foreground">
        {props.searching ? `No ${props.noun} match your search.` : `No ${props.noun} yet.`}
      </td>
    </tr>
  );
}
