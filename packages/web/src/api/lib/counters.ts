import { db } from "../database";
import { counters } from "../database/schema";
import { sql } from "drizzle-orm";

/** Atomically increments a counter and returns the new value. */
async function incrementCounter(id: string): Promise<number> {
  const rows = await db
    .insert(counters)
    .values({ id, value: 1 })
    .onConflictDoUpdate({ target: counters.id, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return rows[0]!.value;
}

export async function nextNumber(prefix: "invoice" | "quote", year: number): Promise<string> {
  const id = `${prefix}_${year}`;
  const value = await incrementCounter(id);
  return `${year}-${String(value).padStart(4, "0")}`;
}

/** Test/draft invoices use a separate counter so they never consume official numbering. */
export async function nextTestNumber(): Promise<string> {
  const value = await incrementCounter("test_invoice");
  return `TEST-${String(value).padStart(4, "0")}`;
}
