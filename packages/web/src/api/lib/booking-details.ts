/**
 * Details every online booking must come with. One validator, used by the public
 * booking page (to guide the person) and by POST /bookings (the real gate) so the
 * two can never disagree about what "filled in" means.
 */
export const BOOKING_DETAIL_FIELDS = ["name", "email", "phone", "address", "zipCode", "city", "country"] as const;
export type BookingDetailField = (typeof BOOKING_DETAIL_FIELDS)[number];
export type BookingDetails = Record<BookingDetailField, string>;
export type BookingDetailErrors = Partial<Record<BookingDetailField, string>>;

const MAX_LEN = 120;

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export function validateBookingDetails(input: Partial<Record<BookingDetailField, unknown>>): {
  ok: boolean;
  errors: BookingDetailErrors;
  values: BookingDetails;
} {
  const values = Object.fromEntries(BOOKING_DETAIL_FIELDS.map((f) => [f, clean(input[f])])) as BookingDetails;
  const errors: BookingDetailErrors = {};

  // Full name: at least two words (first + last name), each with a letter in it.
  const words = values.name.split(" ").filter(Boolean);
  if (words.length < 2 || !words.every((w) => /\p{L}/u.test(w)) || values.name.length > MAX_LEN) {
    errors.name = "Please enter your full name (first and last name).";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email) || values.email.length > 200) {
    errors.email = "Please enter a valid email address.";
  }

  const digits = values.phone.replace(/\D/g, "");
  if (!/^[+\d\s().-]+$/.test(values.phone) || digits.length < 8 || digits.length > 15) {
    errors.phone = "Please enter a valid phone number.";
  }

  if (values.address.length < 3 || values.address.length > MAX_LEN) errors.address = "Please enter your street and house number.";
  if (values.zipCode.length < 3 || values.zipCode.length > 12) errors.zipCode = "Please enter your postcode.";
  if (values.city.length < 2 || values.city.length > MAX_LEN) errors.city = "Please enter your city.";
  if (values.country.length < 2 || values.country.length > MAX_LEN) errors.country = "Please enter your country.";

  return { ok: Object.keys(errors).length === 0, errors, values };
}

/** "Street 1, 1234 AB City, Country" — blank parts skipped. */
export function formatAddress(a: { address?: string | null; zipCode?: string | null; city?: string | null; country?: string | null }): string {
  return [a.address, [a.zipCode, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");
}

/** Description of the Google Calendar event for a booking (shown to Daiane, in Portuguese like the rest of the event). */
export function calendarEventDescription(b: {
  name: string;
  serviceName: string;
  phone?: string | null;
  address?: string | null;
  zipCode?: string | null;
  city?: string | null;
  country?: string | null;
}): string {
  const address = formatAddress(b);
  return [`Nome: ${b.name}`, `Serviço: ${b.serviceName}`, `Telefone: ${b.phone || "—"}`, address ? `Morada: ${address}` : null]
    .filter((l) => l !== null)
    .join("\n");
}
