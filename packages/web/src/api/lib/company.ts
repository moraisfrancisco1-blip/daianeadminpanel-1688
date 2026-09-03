import { db } from "../database";
import { companySettings } from "../database/schema";
import { eq } from "drizzle-orm";

export const COMPANY = {
  name: "Daiane Oakes Body Therapist",
  kvk: "75105659",
  vat: "NL002476652B29",
  iban: "NL93 ABNA 0864 1372 57",
  // Legal/invoice address (KVK registration) — keep on invoices only.
  address: "Bergstraat 46B",
  zipCity: "Rotterdam",
  country: "Netherlands",
  phone: "+31 6 11 66 07 22",
  paymentTermDays: 14,
  adminEmail: "daianeoakes@gmail.com",

  // ── Post-session review & promo email ──────────────────────────────
  // Direct "write a review" link (from Daiane's Google Business listing).
  googleReviewUrl:
    "https://www.google.com/search?q=Studio+Da%C3%AF+Oakes+Cr%C3%ADticas&rflfq=1&num=20&stick=H4sIAAAAAAAAAONgkxK2tDQxtDQzMjQwMjU3tDQ0MjS23MDI-IpROrikNCUzX8El8fB6Bf_E7NRiBeeiw2tLMpMTixex4pMFAORTz0NWAAAA&rldimm=9941962102571912139&tbm=lcl&hl=pt-PT#lkt=LocalPoiReviews",
  instagramHandle: "@dai.oakes",
  instagramUrl: "https://www.instagram.com/dai.oakes",
  // Reward for tagging an Instagram story AND leaving a Google review.
  postSessionPromoAmount: 5, // € off next session
  // Hours after the session start time before the review email goes out.
  postSessionEmailDelayHours: 3,
};

export type CompanyInvoiceDetails = Pick<
  typeof COMPANY,
  "name" | "address" | "zipCity" | "kvk" | "vat" | "iban" | "phone" | "paymentTermDays"
>;

// The invoice-facing subset of COMPANY, overridable from Settings. Falls back
// to the hardcoded defaults above for any field never edited there.
export async function getCompanyInvoiceDetails(): Promise<CompanyInvoiceDetails> {
  const [row] = await db.select().from(companySettings).where(eq(companySettings.id, "primary"));
  if (!row) return COMPANY;
  return {
    name: row.name ?? COMPANY.name,
    address: row.address ?? COMPANY.address,
    zipCity: row.zipCity ?? COMPANY.zipCity,
    kvk: row.kvk ?? COMPANY.kvk,
    vat: row.vat ?? COMPANY.vat,
    iban: row.iban ?? COMPANY.iban,
    phone: row.phone ?? COMPANY.phone,
    paymentTermDays: row.paymentTermDays ?? COMPANY.paymentTermDays,
  };
}

// Practice / studio address (matches daianeoakes.com) — used in all client-facing
// emails, calendar events, and the booking page. Distinct from the KVK/invoice address.
export const PRACTICE_ADDRESS = {
  line1: "Ommoordsweg 32",
  zipCity: "3056 JP Rotterdam",
  full: "Ommoordsweg 32, 3056 JP Rotterdam",
};

// WhatsApp click-to-chat number (E.164 without '+'), used for the "Book via WhatsApp" button.
export const WHATSAPP_CONTACT_NUMBER = "31611660722";
