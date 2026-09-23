import { describe, expect, test } from "bun:test";
import { planBookingPatches, planClientPatch, type BookingContactRow, type Contact } from "./client-sync";

const contact = (o: Partial<Contact> = {}): Contact => ({
  name: "Naiara", email: "naiara@gmail.com", phone: null, address: null, zipCode: null, city: null, country: null, ...o,
});
const row = (id: number, o: Partial<BookingContactRow> = {}): BookingContactRow => ({ id, clientId: 1, ...contact(), ...o });

describe("planBookingPatches", () => {
  test("the reported case: a booking that mirrored the client follows the corrected name, phone and address", () => {
    const before = contact();
    const after = contact({ name: "Naiara Araujo Magalhães", phone: "+31 685270261", address: "Koraal 143", zipCode: "1703 DS", city: "Heerhugowaard", country: "Netherlands" });
    const plan = planBookingPatches(before, after, [row(93)]);
    expect(plan).toEqual([
      { id: 93, patch: { name: "Naiara Araujo Magalhães", phone: "+31 685270261", address: "Koraal 143", zipCode: "1703 DS", city: "Heerhugowaard", country: "Netherlands" } },
    ]);
  });

  test("only the fields that actually changed are touched", () => {
    const plan = planBookingPatches(contact(), contact({ phone: "0611111111" }), [row(1)]);
    expect(plan).toEqual([{ id: 1, patch: { phone: "0611111111" } }]);
  });

  test("nothing changed (or only whitespace/case) => nothing to do", () => {
    expect(planBookingPatches(contact(), contact(), [row(1)])).toEqual([]);
    expect(planBookingPatches(contact(), contact({ name: "  naiara " }), [row(1)])).toEqual([]);
  });

  test("a booking made under a different name is somebody else's: it follows nothing, not even the phone", () => {
    const rows = [row(1), row(2, { name: "Beatriz (daughter)" })];
    expect(planBookingPatches(contact(), contact({ name: "Naiara Araujo" }), rows).map((p) => p.id)).toEqual([1]);
    expect(planBookingPatches(contact(), contact({ phone: "0611111111" }), rows).map((p) => p.id)).toEqual([1]);
  });

  test("a booking with its own different phone keeps it; one with a blank phone gets the new one", () => {
    const before = contact({ phone: "0600000000" });
    const after = contact({ phone: "0699999999" });
    const plan = planBookingPatches(before, after, [row(1, { phone: "0600000000" }), row(2, { phone: "0655555555" }), row(3, { phone: null })]);
    expect(plan.map((p) => p.id)).toEqual([1]); // 3 was blank but the client's OLD phone wasn't, so it wasn't mirroring
  });

  test("blank booking fields take a value the client just received", () => {
    const plan = planBookingPatches(contact({ address: null }), contact({ address: "Koraal 143" }), [row(1, { address: null })]);
    expect(plan).toEqual([{ id: 1, patch: { address: "Koraal 143" } }]);
  });

  test("email changes are followed too, and name/email are never blanked", () => {
    const plan = planBookingPatches(contact(), contact({ email: "new@gmail.com" }), [row(1)]);
    expect(plan).toEqual([{ id: 1, patch: { email: "new@gmail.com" } }]);
    const cleared = planBookingPatches(contact(), contact({ name: "" }), [row(1)]);
    expect(cleared).toEqual([]);
  });

  test("clearing an optional field on the client clears it on mirroring bookings", () => {
    const plan = planBookingPatches(contact({ phone: "0611111111" }), contact({ phone: "" }), [row(1, { phone: "0611111111" })]);
    expect(plan).toEqual([{ id: 1, patch: { phone: null } }]);
  });
});

describe("planClientPatch (the reverse direction: booking edit → client record)", () => {
  test("the reported case: fixing the name/phone on a booking follows onto the client that mirrored it", () => {
    const before = contact();
    const after = contact({ name: "Naiara Araujo Magalhães", phone: "+31 685270261" });
    expect(planClientPatch(before, after, contact())).toEqual({ name: "Naiara Araujo Magalhães", phone: "+31 685270261" });
  });

  test("a client detail already corrected elsewhere is never clobbered by a stale booking edit", () => {
    const before = contact({ phone: "0600000000" });
    const after = contact({ phone: "0699999999" });
    // The client's phone no longer matches what this booking was made with — leave it.
    expect(planClientPatch(before, after, contact({ phone: "0611111111" }))).toEqual({});
  });

  test("a booking made under someone else's name never cascades onto the client", () => {
    const before = contact({ name: "Beatriz (daughter)" });
    const after = contact({ name: "Beatriz (daughter)", phone: "0611111111" });
    expect(planClientPatch(before, after, contact())).toEqual({});
  });

  test("nothing changed => nothing to do", () => {
    expect(planClientPatch(contact(), contact(), contact())).toEqual({});
  });

  test("email changes follow too, and the client's name/email are never blanked", () => {
    expect(planClientPatch(contact(), contact({ email: "new@gmail.com" }), contact())).toEqual({ email: "new@gmail.com" });
    expect(planClientPatch(contact(), contact({ name: "" }), contact())).toEqual({});
  });

  test("a blank client field takes a value the booking just received", () => {
    const plan = planClientPatch(contact({ address: null }), contact({ address: "Koraal 143" }), contact({ address: null }));
    expect(plan).toEqual({ address: "Koraal 143" });
  });
});
