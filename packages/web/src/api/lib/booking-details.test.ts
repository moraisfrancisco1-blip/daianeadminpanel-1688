import { describe, expect, test } from "bun:test";
import { calendarEventDescription, formatAddress, validateBookingDetails } from "./booking-details";

const valid = {
  name: "Tamara Smits",
  email: "tamara@hotmail.com",
  phone: "+31 6 41 28 83 46",
  address: "Ommoordsweg 32",
  zipCode: "3056 JP",
  city: "Rotterdam",
  country: "Netherlands",
};

describe("validateBookingDetails", () => {
  test("accepts a complete set and returns tidy values", () => {
    const r = validateBookingDetails({ ...valid, name: "  Tamara   Smits ", city: " Rotterdam " });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual({});
    expect(r.values.name).toBe("Tamara Smits");
    expect(r.values.city).toBe("Rotterdam");
  });

  test("every field is required", () => {
    for (const field of Object.keys(valid) as (keyof typeof valid)[]) {
      const r = validateBookingDetails({ ...valid, [field]: "" });
      expect(r.ok).toBe(false);
      expect(Object.keys(r.errors)).toEqual([field]);
    }
    expect(validateBookingDetails({}).ok).toBe(false);
    expect(Object.keys(validateBookingDetails({}).errors)).toHaveLength(7);
  });

  test("whitespace-only and non-string values count as empty", () => {
    expect(validateBookingDetails({ ...valid, address: "     " }).errors.address).toBeDefined();
    expect(validateBookingDetails({ ...valid, city: null }).errors.city).toBeDefined();
    expect(validateBookingDetails({ ...valid, zipCode: 12345 }).errors.zipCode).toBeDefined();
  });

  test("full name means at least two words", () => {
    expect(validateBookingDetails({ ...valid, name: "Tamara" }).errors.name).toBeDefined();
    expect(validateBookingDetails({ ...valid, name: "12 34" }).errors.name).toBeDefined();
    expect(validateBookingDetails({ ...valid, name: "Noemi Pinto Dos Santos Sá Pereira Jacob" }).ok).toBe(true);
    expect(validateBookingDetails({ ...valid, name: "Gökhan Yıldız" }).ok).toBe(true);
  });

  test("email must look like an email", () => {
    for (const bad of ["tamara", "tamara@", "tamara@hotmail", "@hotmail.com", "a b@c.com"]) {
      expect(validateBookingDetails({ ...valid, email: bad }).errors.email).toBeDefined();
    }
    expect(validateBookingDetails({ ...valid, email: "tamara-smits1980@hotmail.com" }).ok).toBe(true);
  });

  test("phone: 8-15 digits, only phone-like characters", () => {
    for (const ok of ["0641288346", "+31 6 12345678", "(020) 123-4567", "+55 (11) 91234-5678"]) {
      expect(validateBookingDetails({ ...valid, phone: ok }).errors.phone).toBeUndefined();
    }
    for (const bad of ["1234567", "abc", "06412883x6", "+".repeat(3), "1".repeat(16)]) {
      expect(validateBookingDetails({ ...valid, phone: bad }).errors.phone).toBeDefined();
    }
  });

  test("absurdly long values are rejected", () => {
    expect(validateBookingDetails({ ...valid, address: "x".repeat(200) }).errors.address).toBeDefined();
  });
});

describe("formatAddress / calendarEventDescription", () => {
  test("joins the parts and skips blanks", () => {
    expect(formatAddress({ address: "Ommoordsweg 32", zipCode: "3056 JP", city: "Rotterdam", country: "Netherlands" })).toBe(
      "Ommoordsweg 32, 3056 JP Rotterdam, Netherlands",
    );
    expect(formatAddress({ address: "Rua das Flores 123", city: "Lisboa" })).toBe("Rua das Flores 123, Lisboa");
    expect(formatAddress({})).toBe("");
  });

  test("event description includes the address only when there is one", () => {
    const withAddr = calendarEventDescription({ name: "Tamara Smits", serviceName: "Massage", phone: "0641288346", address: "Ommoordsweg 32", city: "Rotterdam" });
    expect(withAddr).toBe("Nome: Tamara Smits\nServiço: Massage\nTelefone: 0641288346\nMorada: Ommoordsweg 32, Rotterdam");
    const without = calendarEventDescription({ name: "Old Booking", serviceName: "Massage", phone: null });
    expect(without).toBe("Nome: Old Booking\nServiço: Massage\nTelefone: —");
  });
});
