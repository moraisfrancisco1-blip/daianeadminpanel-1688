/**
 * Idempotent database seed.
 *
 * Recreates the service catalog (8 services) and imports clients from
 * clients_seed.json. Safe to run multiple times — it only inserts rows
 * that don't already exist (services matched by name, clients by email).
 *
 * Run against the target database:
 *   cd packages/web && bun --env-file=../../.env run seed.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "./src/api/database";
import { services, clients } from "./src/api/database/schema";
import { eq } from "drizzle-orm";

type SeedService = {
  name: string;
  groupLabel: string;
  description: string;
  durationMinutes: number;
  price: number;
  vatRate: number;
  active: boolean;
  sortOrder: number;
};

const SERVICES: SeedService[] = [
  { name: "Coffee & Talk", groupLabel: "Coffee & Talk", description: "Free intake conversation to understand your needs and goals.", durationMinutes: 20, price: 0, vatRate: 0.09, active: true, sortOrder: 1 },
  { name: "Daï Massage — 30 min", groupLabel: "Daï Massage", description: "Therapeutic massage tailored to your body.", durationMinutes: 30, price: 75, vatRate: 0.09, active: true, sortOrder: 2 },
  { name: "Daï Massage — 60 min", groupLabel: "Daï Massage", description: "Therapeutic massage tailored to your body.", durationMinutes: 60, price: 100, vatRate: 0.09, active: true, sortOrder: 3 },
  { name: "Daï Massage — 90 min", groupLabel: "Daï Massage", description: "Therapeutic massage tailored to your body.", durationMinutes: 90, price: 125, vatRate: 0.09, active: true, sortOrder: 4 },
  { name: "Women's Recovery & PostPartum", groupLabel: "Women's Recovery & PostPartum", description: "Postpartum recovery and women's health therapy.", durationMinutes: 60, price: 100, vatRate: 0.09, active: true, sortOrder: 5 },
  { name: "Pregnancy & Birth Preparation", groupLabel: "Pregnancy & Birth Preparation", description: "Preparation and support through pregnancy and birth.", durationMinutes: 60, price: 100, vatRate: 0.09, active: true, sortOrder: 6 },
  { name: "Pelvic Floor Recovery", groupLabel: "Pelvic Floor Recovery", description: "Pelvic floor assessment and recovery therapy.", durationMinutes: 60, price: 100, vatRate: 0.09, active: true, sortOrder: 7 },
  { name: "Clinical Pilates", groupLabel: "Clinical Pilates", description: "Personalized clinical Pilates session.", durationMinutes: 60, price: 100, vatRate: 0.09, active: true, sortOrder: 8 },
];

type SeedClient = {
  code?: number;
  name: string;
  phone?: string | null;
  dateOfBirth?: string | null;
  address?: string | null;
  zipCode?: string | null;
  city?: string | null;
  country?: string | null;
  email?: string | null;
};

async function seedServices() {
  let inserted = 0;
  for (const s of SERVICES) {
    const [existing] = await db.select().from(services).where(eq(services.name, s.name));
    if (existing) continue;
    await db.insert(services).values(s);
    inserted++;
  }
  const total = (await db.select().from(services)).length;
  console.log(`[seed] services: +${inserted} inserted, ${total} total`);
}

async function seedClients() {
  const path = join(import.meta.dir, "clients_seed.json");
  let raw: SeedClient[];
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.log("[seed] clients_seed.json not found — skipping clients");
    return;
  }

  let inserted = 0;
  for (const c of raw) {
    const email = c.email?.trim() || null;
    // Match by email when present; otherwise by name to avoid duplicates.
    if (email) {
      const [existing] = await db.select().from(clients).where(eq(clients.email, email));
      if (existing) continue;
    } else {
      const [existing] = await db.select().from(clients).where(eq(clients.name, c.name));
      if (existing) continue;
    }

    let dob: Date | null = null;
    if (c.dateOfBirth) {
      const d = new Date(c.dateOfBirth);
      if (!Number.isNaN(d.getTime())) dob = d;
    }

    await db.insert(clients).values({
      name: c.name,
      email,
      phone: c.phone?.trim() || null,
      address: c.address?.trim() || null,
      zipCode: c.zipCode?.trim() || null,
      city: c.city?.trim() || null,
      country: c.country?.trim() || null,
      dateOfBirth: dob,
      debtorNumber: c.code != null ? String(Math.round(c.code)) : null,
    });
    inserted++;
  }
  const total = (await db.select().from(clients)).length;
  console.log(`[seed] clients: +${inserted} inserted, ${total} total`);
}

await seedServices();
await seedClients();
console.log("[seed] done");
process.exit(0);
