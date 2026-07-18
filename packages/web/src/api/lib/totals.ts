export interface LineInput {
  description: string;
  serviceId?: number | null;
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

export function computeTotals(items: LineInput[]) {
  let subtotal = 0;
  let vatTotal = 0;
  const byRate = new Map<number, { base: number; vat: number }>();

  const lineItems = items.map((item) => {
    const amount = Number((item.quantity * item.unitPrice).toFixed(2));
    const vat = Number((amount * item.vatRate).toFixed(2));
    subtotal += amount;
    vatTotal += vat;
    const acc = byRate.get(item.vatRate) ?? { base: 0, vat: 0 };
    acc.base += amount;
    acc.vat += vat;
    byRate.set(item.vatRate, acc);
    return { ...item, amount };
  });

  const vatBreakdown = Array.from(byRate.entries()).map(([rate, v]) => ({
    rate,
    base: Number(v.base.toFixed(2)),
    vat: Number(v.vat.toFixed(2)),
  }));

  return {
    lineItems,
    subtotal: Number(subtotal.toFixed(2)),
    vatTotal: Number(vatTotal.toFixed(2)),
    total: Number((subtotal + vatTotal).toFixed(2)),
    vatBreakdown,
  };
}
