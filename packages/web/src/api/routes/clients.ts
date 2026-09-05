import { Hono } from "hono";
import { db } from "../database";
import { clients, invoices, bookings, payments, quotes, services, clientNotes, packages } from "../database/schema";
import { eq, desc, inArray, or } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { createStripeCustomer, updateStripeCustomer, findStripeCustomerByEmail } from "../services/stripe-sync";

export const clientsRoute = new Hono()
  .get("/", requireAuth, async (c) => {
    const all = await db.select().from(clients).orderBy(desc(clients.createdAt));
    return c.json({ clients: all }, 200);
  })
  .get("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    if (!client) return c.json({ message: "Not found" }, 404);

    const clientInvoices = await db
      .select()
      .from(invoices)
      .where(eq(invoices.clientId, id))
      .orderBy(desc(invoices.issueDate));

    const clientQuotes = await db
      .select()
      .from(quotes)
      .where(eq(quotes.clientId, id))
      .orderBy(desc(quotes.issueDate));

    const invoiceIds = clientInvoices.map((i) => i.id);
    const clientPayments = invoiceIds.length
      ? await db.select().from(payments).where(inArray(payments.invoiceId, invoiceIds)).orderBy(desc(payments.paidAt))
      : [];

    const clientBookings = await db
      .select({
        id: bookings.id,
        name: bookings.name,
        email: bookings.email,
        phone: bookings.phone,
        serviceId: bookings.serviceId,
        serviceName: services.name,
        date: bookings.date,
        startTime: bookings.startTime,
        status: bookings.status,
        depositAmount: bookings.depositAmount,
        depositStatus: bookings.depositStatus,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .where(client.email ? or(eq(bookings.clientId, id), eq(bookings.email, client.email)) : eq(bookings.clientId, id))
      .orderBy(desc(bookings.date));

    const clientNotesList = await db
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.clientId, id))
      .orderBy(desc(clientNotes.createdAt));

    const clientPackages = await db
      .select()
      .from(packages)
      .where(eq(packages.clientId, id))
      .orderBy(desc(packages.purchasedAt));

    return c.json(
      {
        client,
        invoices: clientInvoices,
        quotes: clientQuotes,
        payments: clientPayments,
        bookings: clientBookings,
        notes: clientNotesList,
        packages: clientPackages,
      },
      200,
    );
  })
  .post("/:id/notes", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    if (!client) return c.json({ message: "Not found" }, 404);

    const body = await c.req.json();
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) return c.json({ message: "Note content is required" }, 400);

    const [note] = await db.insert(clientNotes).values({ clientId: id, content }).returning();
    return c.json({ note }, 201);
  })
  .put("/:id/notes/:noteId/resolve", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const noteId = Number(c.req.param("noteId"));
    const [existing] = await db.select().from(clientNotes).where(eq(clientNotes.id, noteId));
    if (!existing || existing.clientId !== id) return c.json({ message: "Not found" }, 404);

    const [note] = await db
      .update(clientNotes)
      .set({ resolved: true, resolvedAt: new Date() })
      .where(eq(clientNotes.id, noteId))
      .returning();
    return c.json({ note }, 200);
  })
  .put("/:id/notes/:noteId/unresolve", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const noteId = Number(c.req.param("noteId"));
    const [existing] = await db.select().from(clientNotes).where(eq(clientNotes.id, noteId));
    if (!existing || existing.clientId !== id) return c.json({ message: "Not found" }, 404);

    const [note] = await db
      .update(clientNotes)
      .set({ resolved: false, resolvedAt: null })
      .where(eq(clientNotes.id, noteId))
      .returning();
    return c.json({ note }, 200);
  })
  .delete("/:id/notes/:noteId", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const noteId = Number(c.req.param("noteId"));
    const [existing] = await db.select().from(clientNotes).where(eq(clientNotes.id, noteId));
    if (!existing || existing.clientId !== id) return c.json({ message: "Not found" }, 404);

    await db.delete(clientNotes).where(eq(clientNotes.id, noteId));
    return c.json({ success: true }, 200);
  })
  .post("/", requireAuth, async (c) => {
    const body = await c.req.json();
    
    // Create client in Stripe first (if Stripe is configured)
    const stripeCustomerId = await createStripeCustomer({
      name: body.name,
      email: body.email ?? null,
      phone: body.phone ?? null,
      address: body.address ?? null,
      city: body.city ?? null,
      country: body.country ?? null,
      zipCode: body.zipCode ?? null,
    });
    
    const [client] = await db
      .insert(clients)
      .values({
        name: body.name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        zipCode: body.zipCode ?? null,
        city: body.city ?? null,
        country: body.country ?? null,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
        notes: body.notes ?? null,
        clinicalNotes: body.clinicalNotes ?? null,
        debtorNumber: body.debtorNumber ?? null,
        stripeCustomerId,
      })
      .returning();
    return c.json({ client }, 201);
  })
  .put("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    
    // Get existing client to check for stripeCustomerId
    const [existingClient] = await db.select().from(clients).where(eq(clients.id, id));
    if (!existingClient) return c.json({ message: "Not found" }, 404);
    
    // Resolve the Stripe customer: keep existing link, or associate by email if none.
    let stripeCustomerId = existingClient.stripeCustomerId;
    if (!stripeCustomerId && body.email) {
      stripeCustomerId = await findStripeCustomerByEmail(body.email);
    }

    // Update the linked customer in Stripe (reuses existing — never creates a duplicate here).
    if (stripeCustomerId) {
      await updateStripeCustomer(stripeCustomerId, {
        name: body.name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        city: body.city ?? null,
        country: body.country ?? null,
        zipCode: body.zipCode ?? null,
      });
    }
    
    // Fields the caller omits keep their current value — lets callers (like the
    // client detail page's clinical notes editor) update just one field
    // without having to resend the whole client record.
    const [client] = await db
      .update(clients)
      .set({
        name: body.name ?? existingClient.name,
        email: body.email !== undefined ? body.email : existingClient.email,
        phone: body.phone !== undefined ? body.phone : existingClient.phone,
        address: body.address !== undefined ? body.address : existingClient.address,
        zipCode: body.zipCode !== undefined ? body.zipCode : existingClient.zipCode,
        city: body.city !== undefined ? body.city : existingClient.city,
        country: body.country !== undefined ? body.country : existingClient.country,
        dateOfBirth: body.dateOfBirth !== undefined ? (body.dateOfBirth ? new Date(body.dateOfBirth) : null) : existingClient.dateOfBirth,
        notes: body.notes !== undefined ? body.notes : existingClient.notes,
        clinicalNotes: body.clinicalNotes !== undefined ? body.clinicalNotes : existingClient.clinicalNotes,
        debtorNumber: body.debtorNumber !== undefined ? body.debtorNumber : existingClient.debtorNumber,
        stripeCustomerId,
      })
      .where(eq(clients.id, id))
      .returning();
    return c.json({ client }, 200);
  })
  .delete("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    
    // Get existing client to check for stripeCustomerId
    const [existingClient] = await db.select().from(clients).where(eq(clients.id, id));
    if (!existingClient) return c.json({ message: "Not found" }, 404);
    
    // NOTE: we intentionally do NOT delete the Stripe customer.
    // The Stripe customer and its financial history (invoices, charges) are preserved.
    
    await db.delete(clients).where(eq(clients.id, id));
    return c.json({ success: true }, 200);
  });
