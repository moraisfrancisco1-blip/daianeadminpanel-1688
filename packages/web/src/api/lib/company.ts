export const COMPANY = {
  name: "Daiane Oakes Body Therapist",
  kvk: "75105659",
  vat: "NL002476652B29",
  iban: "NL93 ABNA 0864 1372 57",
  address: "Bergstraat 46B",
  zipCity: "Rotterdam",
  country: "Netherlands",
  phone: "+31 6 11 66 07 22",
  paymentTermDays: 14,
  adminEmail: "daianeoakes@gmail.com",

  // ── Post-session review & promo email ──────────────────────────────
  // Direct "write a review" link. Replace with the official short link from your
  // Google Business Profile ("Ask for reviews" → Copy link, looks like https://g.page/r/xxxx/review).
  // The fallback below opens your business on Google Maps so clients can still leave a review.
  googleReviewUrl: "https://www.google.com/maps/search/?api=1&query=Da%C3%AF+Oakes+Body+Therapist+Rotterdam",
  instagramHandle: "@dai.oakes",
  instagramUrl: "https://www.instagram.com/dai.oakes",
  // Reward for tagging an Instagram story AND leaving a Google review.
  postSessionPromoAmount: 5, // € off next session
  // Hours after the session start time before the review email goes out.
  postSessionEmailDelayHours: 3,
};
