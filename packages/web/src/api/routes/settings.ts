import { Hono } from "hono";
import { db } from "../database";
import { companySettings } from "../database/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { getCompanyInvoiceDetails } from "../lib/company";

export const settingsRoute = new Hono()
  .get("/company", requireAuth, async (c) => {
    const company = await getCompanyInvoiceDetails();
    return c.json({ company }, 200);
  })
  .put("/company", requireAuth, async (c) => {
    const body = await c.req.json();
    const values = {
      name: body.name || null,
      address: body.address || null,
      zipCity: body.zipCity || null,
      kvk: body.kvk || null,
      vat: body.vat || null,
      iban: body.iban || null,
      phone: body.phone || null,
      paymentTermDays: body.paymentTermDays ? Number(body.paymentTermDays) : null,
    };

    const [existing] = await db.select().from(companySettings).where(eq(companySettings.id, "primary"));
    if (existing) {
      await db
        .update(companySettings)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(companySettings.id, "primary"));
    } else {
      await db.insert(companySettings).values({ id: "primary", ...values });
    }

    const company = await getCompanyInvoiceDetails();
    return c.json({ company }, 200);
  });
