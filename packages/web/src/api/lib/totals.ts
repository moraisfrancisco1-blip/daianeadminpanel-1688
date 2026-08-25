export const DEFAULT_VAT_RATE = 0.09;

/** Round a monetary value to 2 decimal places (half-up via toFixed). */
export function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Split a GROSS (VAT-inclusive) amount into net + VAT.
 *
 * The configured service price is always the FINAL price the client pays.
 *   net = gross / (1 + vatRate)
 *   vat = gross - net
 */
export function computeVat(gross: number, vatRate: number): { net: number; vat: number } {
  const net = round2(gross / (1 + vatRate));
  const vat = round2(gross - net);
  return { net, vat };
}

export interface LineInput {
  description: string;
  serviceId?: number | null;
  quantity: number;
  /** GROSS unit price — the final amount the client pays for one unit. */
  unitPrice: number;
  vatRate: number;
}

/**
 * Central VAT calculation for invoices and quotes.
 *
 * `unitPrice` is treated as the GROSS (final) price. The returned `lineItems`
 * carry the NET unit price / NET amount so the PDF and screens show the same
 * figures as the example (UNIT PRICE = net, AMOUNT = net, TOTAL = gross).
 */
/** Convert a NET amount back to its GROSS (final) price for editing. */
export function netToGross(net: number, vatRate: number): number {
  return round2(net * (1 + vatRate));
}

/** Build a per-rate VAT breakdown from already-NET line amounts. */
export function vatBreakdownFromNet(items: { amount: number; vatRate: number }[]) {
  const byRate = new Map<number, { base: number; vat: number }>();
  for (const item of items) {
    const acc = byRate.get(item.vatRate) ?? { base: 0, vat: 0 };
    acc.base = round2(acc.base + item.amount);
    acc.vat = round2(acc.vat + round2(item.amount * item.vatRate));
    byRate.set(item.vatRate, acc);
  }
  return Array.from(byRate.entries()).map(([rate, v]) => ({
    rate,
    base: round2(v.base),
    vat: round2(v.vat),
  }));
}

export function computeTotals(items: LineInput[]) {
  let subtotal = 0; // net total
  let vatTotal = 0;
  let grossTotal = 0;
  const byRate = new Map<number, { base: number; vat: number }>();

  const lineItems = items.map((item) => {
    const gross = round2(item.quantity * item.unitPrice);
    const { net, vat } = computeVat(gross, item.vatRate);
    subtotal = round2(subtotal + net);
    vatTotal = round2(vatTotal + vat);
    grossTotal = round2(grossTotal + gross);

    const acc = byRate.get(item.vatRate) ?? { base: 0, vat: 0 };
    acc.base = round2(acc.base + net);
    acc.vat = round2(acc.vat + vat);
    byRate.set(item.vatRate, acc);

    const netUnitPrice = round2(net / (item.quantity || 1));
    return { ...item, unitPrice: netUnitPrice, amount: net };
  });

  const vatBreakdown = Array.from(byRate.entries()).map(([rate, v]) => ({
    rate,
    base: round2(v.base),
    vat: round2(v.vat),
  }));

  return {
    lineItems,
    subtotal: round2(subtotal),
    vatTotal: round2(vatTotal),
    total: round2(grossTotal),
    vatBreakdown,
  };
}

