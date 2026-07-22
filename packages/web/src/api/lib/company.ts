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

// Practice / studio address (matches daianeoakes.com) — used in all client-facing
// emails, calendar events, and the booking page. Distinct from the KVK/invoice address.
export const PRACTICE_ADDRESS = {
  line1: "Ommoordsweg 32",
  zipCity: "3056 JP Rotterdam",
  full: "Ommoordsweg 32, 3056 JP Rotterdam",
};

// WhatsApp click-to-chat number (E.164 without '+'), used for the "Book via WhatsApp" button.
export const WHATSAPP_CONTACT_NUMBER = "31611660722";
