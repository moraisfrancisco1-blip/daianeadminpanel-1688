import { Hono } from "hono";
import { db } from "../database";
import { clients, invoices } from "../database/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { createStripeCustomer, updateStripeCustomer, deleteStripeCustomer } from "../services/stripe-sync";

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
    return c.json({ client, invoices: clientInvoices }, 200);
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
    
    // Update client in Stripe if they have a stripeCustomerId
    if (existingClient.stripeCustomerId) {
      await updateStripeCustomer(existingClient.stripeCustomerId, {
        name: body.name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        city: body.city ?? null,
        country: body.country ?? null,
        zipCode: body.zipCode ?? null,
      });
    }
    
    const [client] = await db
      .update(clients)
      .set({
        name: body.name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        zipCode: body.zipCode ?? null,
        city: body.city ?? null,
        country: body.country ?? null,
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
        notes: body.notes ?? null,
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
    
    // Delete client from Stripe if they have a stripeCustomerId
    if (existingClient.stripeCustomerId) {
      await deleteStripeCustomer(existingClient.stripeCustomerId);
    }
    
    await db.delete(clients).where(eq(clients.id, id));
    return c.json({ success: true }, 200);
  });
