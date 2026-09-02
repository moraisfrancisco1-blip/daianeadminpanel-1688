import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";

// Dutch address lookup by postcode + house number, via PDOK's Locatieserver —
// a free, keyless, official Kadaster (Dutch land registry) API. No API key
// or account needed, so nothing to configure.
const PDOK_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free";

type PdokDoc = {
  straatnaam?: string;
  huisnummer?: number;
  huisletter?: string;
  postcode?: string;
  woonplaatsnaam?: string;
  gemeentenaam?: string;
};

export const addressLookupRoute = new Hono().get("/", requireAuth, async (c) => {
  const rawPostcode = c.req.query("postcode") ?? "";
  const houseNumber = (c.req.query("houseNumber") ?? "").trim();

  // Normalize "1012 JS" / "1012js" -> "1012JS".
  const postcode = rawPostcode.replace(/\s+/g, "").toUpperCase();
  if (!/^[1-9][0-9]{3}[A-Z]{2}$/.test(postcode)) {
    return c.json({ message: "Invalid postcode. Expected format: 1234AB." }, 400);
  }
  if (!houseNumber || !/^\d+$/.test(houseNumber)) {
    return c.json({ message: "House number is required." }, 400);
  }

  const url = new URL(PDOK_URL);
  url.searchParams.set("q", `postcode:${postcode} AND huisnummer:${houseNumber}`);
  url.searchParams.set("fq", "type:adres");
  url.searchParams.set("fl", "straatnaam,huisnummer,huisletter,postcode,woonplaatsnaam,gemeentenaam");
  url.searchParams.set("rows", "1");

  let doc: PdokDoc | undefined;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return c.json({ found: false, message: "Address lookup service unavailable." }, 200);
    const data = (await res.json()) as { response?: { docs?: PdokDoc[] } };
    doc = data.response?.docs?.[0];
  } catch (err) {
    console.error("[address-lookup] PDOK request failed:", err);
    return c.json({ found: false, message: "Address lookup service unavailable." }, 200);
  }

  if (!doc || !doc.straatnaam) {
    return c.json({ found: false, message: "No address found for that postcode and house number." }, 200);
  }

  return c.json(
    {
      found: true,
      street: doc.straatnaam,
      houseNumber: String(doc.huisnummer ?? houseNumber) + (doc.huisletter ?? ""),
      postcode: doc.postcode ?? postcode,
      city: doc.woonplaatsnaam ?? doc.gemeentenaam ?? "",
    },
    200,
  );
});
