import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "./ui/button";

export interface LineItemDraft {
  description: string;
  serviceId?: number | null;
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

export function LineItemEditor({
  items,
  onChange,
  services,
}: {
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
  services: { id: number; name: string; price: number; vatRate: number }[];
}) {
  function update(i: number, patch: Partial<LineItemDraft>) {
    const next = [...items];
    next[i] = { ...next[i]!, ...patch };
    onChange(next);
  }

  function addItem() {
    onChange([...items, { description: "", quantity: 1, unitPrice: 0, vatRate: 0.09 }]);
  }

  function removeItem(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  function applyService(i: number, serviceId: number) {
    const svc = services.find((s) => s.id === serviceId);
    if (!svc) return;
    update(i, { serviceId, description: svc.name, unitPrice: svc.price, vatRate: svc.vatRate });
  }

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const vatTotal = items.reduce((s, i) => s + i.quantity * i.unitPrice * i.vatRate, 0);

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center border sm:border-0 border-border rounded-lg p-2 sm:p-0">
          <select
            className="col-span-2 sm:col-span-3 h-9 px-2 rounded-md border border-input bg-background text-xs"
            value={item.serviceId ?? ""}
            onChange={(e) => applyService(i, Number(e.target.value))}
          >
            <option value="">Custom</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            className="col-span-2 sm:col-span-4 h-9 px-2 rounded-md border border-input bg-background text-xs"
            placeholder="Description"
            value={item.description}
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <input
            type="number"
            placeholder="Qty"
            className="col-span-1 sm:col-span-1 h-9 px-2 rounded-md border border-input bg-background text-xs"
            value={item.quantity}
            onChange={(e) => update(i, { quantity: Number(e.target.value) })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Price"
            className="col-span-1 sm:col-span-2 h-9 px-2 rounded-md border border-input bg-background text-xs"
            value={item.unitPrice}
            onChange={(e) => update(i, { unitPrice: Number(e.target.value) })}
          />
          <select
            className="col-span-1 sm:col-span-1 h-9 px-1 rounded-md border border-input bg-background text-xs"
            value={item.vatRate}
            onChange={(e) => update(i, { vatRate: Number(e.target.value) })}
          >
            <option value={0.09}>9%</option>
            <option value={0.21}>21%</option>
            <option value={0}>0%</option>
          </select>
          <button
            type="button"
            onClick={() => removeItem(i)}
            className="col-span-1 flex justify-center text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="flex items-center gap-1.5 text-sm text-primary font-medium"
      >
        <Plus className="size-4" /> Add line
      </button>
      <div className="flex justify-end gap-6 text-sm pt-2 border-t border-border">
        <span className="text-muted-foreground">Subtotal: €{subtotal.toFixed(2)}</span>
        <span className="text-muted-foreground">VAT: €{vatTotal.toFixed(2)}</span>
        <span className="font-semibold">Total: €{(subtotal + vatTotal).toFixed(2)}</span>
      </div>
    </div>
  );
}
