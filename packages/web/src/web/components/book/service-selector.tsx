import { Fragment, type ReactNode } from "react";

interface Service {
  id: number;
  name: string;
  groupLabel: string | null;
  description: string | null;
  durationMinutes: number;
  price: number;
}

export function ServiceSelector({
  services,
  selectedId,
  onSelect,
}: {
  services: Service[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const groups = new Map<string, Service[]>();
  const standalone: Service[] = [];
  for (const s of services) {
    if (s.groupLabel) {
      if (!groups.has(s.groupLabel)) groups.set(s.groupLabel, []);
      groups.get(s.groupLabel)!.push(s);
    } else {
      standalone.push(s);
    }
  }

  const entries: { key: string; label: string; node: ReactNode }[] = [];

  for (const [label, variants] of groups.entries()) {
    const selected = variants.find((v) => v.id === selectedId);
    entries.push({
      key: label,
      label,
      node: (
        <div
          className={`rounded-lg border p-4 transition-colors ${
            selected ? "border-brand-copper bg-brand-copper/5" : "border-brand-tan/25 bg-white"
          }`}
        >
          <p className="font-display text-sm text-brand-teal mb-1">{label}</p>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">{variants[0]?.description}</p>
          <div className="flex flex-wrap gap-2">
            {variants
              .sort((a, b) => a.durationMinutes - b.durationMinutes)
              .map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onSelect(v.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                    selectedId === v.id
                      ? "bg-brand-copper text-white border-brand-copper"
                      : "border-brand-tan/40 bg-background hover:border-brand-copper"
                  }`}
                >
                  {v.durationMinutes} min — €{v.price.toFixed(0)}
                </button>
              ))}
          </div>
        </div>
      ),
    });
  }

  for (const s of standalone) {
    entries.push({
      key: String(s.id),
      label: s.name,
      node: (
        <button
          type="button"
          onClick={() => onSelect(s.id)}
          className={`w-full text-left rounded-lg border p-4 transition-colors ${
            selectedId === s.id ? "border-brand-copper bg-brand-copper/5" : "border-brand-tan/25 bg-white hover:border-brand-copper/50"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-sm text-brand-teal mb-1">{s.name}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.description}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-brand-copper">{s.price === 0 ? "Free" : `€${s.price.toFixed(0)}`}</p>
              <p className="text-[11px] text-muted-foreground">{s.durationMinutes} min</p>
            </div>
          </div>
        </button>
      ),
    });
  }

  entries.sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-3">
      {entries.map((e) => (
        <Fragment key={e.key}>{e.node}</Fragment>
      ))}
    </div>
  );
}
