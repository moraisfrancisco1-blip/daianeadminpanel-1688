interface Service {
  id: number;
  name: string;
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
  const sorted = [...services].sort((a, b) => a.name.localeCompare(b.name) || a.durationMinutes - b.durationMinutes);

  return (
    <div className="space-y-3">
      {sorted.map((s) => (
        <button
          key={s.id}
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
      ))}
    </div>
  );
}
