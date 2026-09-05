import { Hono } from "hono";
import { put, del } from "@vercel/blob";
import { db } from "../database";
import { expenses } from "../database/schema";
import { eq, desc, and, gte, lt } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { extractExpenseFromFile } from "../services/expense-extract";
import { recordAudit, actorFromContext } from "../lib/audit";

export const expensesRoute = new Hono()
  .get("/", requireAuth, async (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    const conds = [];
    if (from) conds.push(gte(expenses.issueDate, new Date(`${from}T00:00:00`)));
    if (to) conds.push(lt(expenses.issueDate, new Date(`${to}T23:59:59`)));
    const rows = await db
      .select()
      .from(expenses)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(expenses.issueDate));
    return c.json({ expenses: rows }, 200);
  })
  // Uploads the file to blob storage and, if ANTHROPIC_API_KEY is configured,
  // reads it with Claude vision to suggest field values — the admin still
  // reviews everything in the form before it's saved via POST /.
  .post("/scan", requireAuth, async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ message: "No file uploaded" }, 400);
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return c.json({ message: "Only PDF, JPEG, PNG or WebP files are supported" }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let attachmentUrl: string | null = null;
    try {
      const blob = await put(`expenses/${Date.now()}-${file.name}`, buffer, { access: "public", contentType: file.type });
      attachmentUrl = blob.url;
    } catch (err) {
      console.error("[expenses] Blob upload failed:", err);
      return c.json({ message: "Failed to store the file — check BLOB_READ_WRITE_TOKEN is configured" }, 500);
    }

    let extracted = null;
    let extractError: string | null = null;
    try {
      extracted = await extractExpenseFromFile(buffer, file.type);
    } catch (err) {
      extractError = err instanceof Error ? err.message : "Auto-detection failed";
      console.error("[expenses] Extraction failed:", err);
    }

    return c.json({ attachmentUrl, attachmentFilename: file.name, extracted, extractError }, 200);
  })
  .post("/", requireAuth, async (c) => {
    const body = await c.req.json();
    if (!body.supplier || body.netAmount == null || !body.issueDate) {
      return c.json({ message: "supplier, netAmount and issueDate are required" }, 400);
    }
    const [expense] = await db
      .insert(expenses)
      .values({
        supplier: body.supplier,
        category: body.category ?? null,
        invoiceNumber: body.invoiceNumber ?? null,
        issueDate: new Date(body.issueDate),
        netAmount: Number(body.netAmount),
        vatAmount: Number(body.vatAmount ?? 0),
        vatRate: Number(body.vatRate ?? 0.21),
        totalAmount: Number(body.totalAmount ?? Number(body.netAmount) + Number(body.vatAmount ?? 0)),
        notes: body.notes ?? null,
        attachmentUrl: body.attachmentUrl ?? null,
        attachmentFilename: body.attachmentFilename ?? null,
      })
      .returning();
    return c.json({ expense }, 201);
  })
  .put("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json();
    const [expense] = await db
      .update(expenses)
      .set({
        supplier: body.supplier,
        category: body.category ?? null,
        invoiceNumber: body.invoiceNumber ?? null,
        issueDate: body.issueDate ? new Date(body.issueDate) : undefined,
        netAmount: body.netAmount != null ? Number(body.netAmount) : undefined,
        vatAmount: body.vatAmount != null ? Number(body.vatAmount) : undefined,
        vatRate: body.vatRate != null ? Number(body.vatRate) : undefined,
        totalAmount: body.totalAmount != null ? Number(body.totalAmount) : undefined,
        notes: body.notes ?? null,
      })
      .where(eq(expenses.id, id))
      .returning();
    if (!expense) return c.json({ message: "Not found" }, 404);
    return c.json({ expense }, 200);
  })
  .delete("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const [existing] = await db.select().from(expenses).where(eq(expenses.id, id));
    if (existing?.attachmentUrl) {
      try {
        await del(existing.attachmentUrl);
      } catch (err) {
        console.error("[expenses] Failed to delete blob (continuing anyway):", err);
      }
    }
    await db.delete(expenses).where(eq(expenses.id, id));
    await recordAudit({
      actor: actorFromContext(c),
      action: "deleted",
      entityType: "expense",
      entityId: id,
      metadata: existing ? { supplier: existing.supplier, totalAmount: existing.totalAmount } : undefined,
    });
    return c.json({ success: true }, 200);
  });
