import { db } from "../database";
import { counters } from "../database/schema";
import { eq, sql } from "drizzle-orm";

export async function nextNumber(prefix: "invoice" | "quote", year: number): Promise<string> {
  const id = `${prefix}_${year}`;
  const existing = await db.select().from(counters).where(eq(counters.id, id));
  if (existing.length === 0) {
    await db.insert(counters).values({ id, value: 1 });
    return `${year}-${String(1).padStart(4, "0")}`;
  }
  const updated = await db
    .update(counters)
    .set({ value: sql`${counters.value} + 1` })
    .where(eq(counters.id, id))
    .returning();
  const value = updated[0]!.value;
  return `${year}-${String(value).padStart(4, "0")}`;
}
