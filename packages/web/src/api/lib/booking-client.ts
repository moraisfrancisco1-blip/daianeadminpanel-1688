import { db } from "../database";
import { clients } from "../database/schema";
import { eq } from "drizzle-orm";

type BookingContact = {
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  zipCode?: string | null;
  city?: string | null;
  country?: string | null;
};

const FILLABLE = ["phone", "address", "zipCode", "city", "country"] as const;

/**
 * The client a booking belongs to, looked up by email and created if new — with the
 * contact details given at booking time. For an existing client only BLANK fields are
 * filled in: what is already on file (possibly corrected by the admin) is never
 * overwritten by something typed into a public form.
 */
export async function findOrCreateClientForBooking(b: BookingContact) {
  const [existing] = await db.select().from(clients).where(eq(clients.email, b.email));

  if (!existing) {
    const [created] = await db
      .insert(clients)
      .values({
        name: b.name,
        email: b.email,
        phone: b.phone || null,
        address: b.address || null,
        zipCode: b.zipCode || null,
        city: b.city || null,
        country: b.country || null,
      })
      .returning();
    return created!;
  }

  const patch: Partial<Record<(typeof FILLABLE)[number], string>> = {};
  for (const key of FILLABLE) {
    const incoming = b[key];
    if (!existing[key] && incoming) patch[key] = incoming;
  }
  if (Object.keys(patch).length === 0) return existing;

  const [updated] = await db.update(clients).set(patch).where(eq(clients.id, existing.id)).returning();
  return updated!;
}
