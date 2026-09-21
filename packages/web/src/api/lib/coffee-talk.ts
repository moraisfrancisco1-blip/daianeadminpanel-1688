/**
 * The free intake call is the one service that can be booked on Tuesdays and
 * Thursdays by Rotterdam clients too (every other service keeps the strict
 * location split: Rotterdam Mon/Wed/Fri, Amsterdam Tue/Thu). Matched by name
 * because there is no service "type" column — services are edited freely in
 * the catalog, so tolerate spacing/case ("Coffee & Talk", "coffee&talk").
 */
export function isCoffeeTalkService(service: { name: string } | null | undefined): boolean {
  return !!service && /^\s*coffee\s*(&|and)\s*talk\b/i.test(service.name);
}

/**
 * The location whose weekday rules apply when scheduling this service.
 * `undefined` means "any working weekday" (used for Coffee & Talk with Rotterdam).
 */
export function schedulingLocation<L extends string>(
  location: L | undefined,
  service: { name: string } | null | undefined,
): L | undefined {
  return location === "rotterdam" && isCoffeeTalkService(service) ? undefined : location;
}
