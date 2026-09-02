export interface ServiceForDescription {
  name: string;
  description?: string | null;
  durationMinutes?: number | null;
}

// For Deep CORE Somatic Mobility services, invoices must show the clinical
// description ("NN' Deep CORE Somatic Mobility") rather than the internal
// catalog name ("Daï Massage — NN min") — required for the 9% VAT filing.
export function invoiceDescriptionForService(svc: ServiceForDescription): string {
  const isDcs = !!svc.description && /deep core somatic/i.test(svc.description);
  if (!isDcs) return svc.name;
  const durationPrefix = svc.durationMinutes ? `${svc.durationMinutes}' ` : "";
  return `${durationPrefix}${svc.description}`;
}
