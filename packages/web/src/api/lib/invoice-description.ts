export interface ServiceForDescription {
  name: string;
  description?: string | null;
  durationMinutes?: number | null;
}

export const DCS_LABEL = "Deep CORE Somatic Mobility";

// The word "massage" must never appear on an invoice — any service that is (or
// is tagged as) a Daï Massage / Deep CORE Somatic Mobility session shows this
// fixed clinical label instead of the internal catalog name, regardless of what
// the catalog service happens to be named — required for the 9% VAT filing.
export function invoiceDescriptionForService(svc: ServiceForDescription): string {
  const isDcs = /massage/i.test(svc.name) || (!!svc.description && /deep core somatic/i.test(svc.description));
  if (!isDcs) return svc.name;
  const durationPrefix = svc.durationMinutes ? `${svc.durationMinutes}' ` : "";
  return `${durationPrefix}${DCS_LABEL}`;
}
