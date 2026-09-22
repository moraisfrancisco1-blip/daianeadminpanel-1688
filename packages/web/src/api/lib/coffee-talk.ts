/**
 * The free intake call is the one service with its own weekday rule for ONLINE
 * bookings: unlike every other service (which keeps the strict location split —
 * Rotterdam Mon/Wed/Fri, Amsterdam Tue/Thu, exclusive to each other), Coffee &
 * Talk is only offered on Tuesdays and Thursdays, for either location. Manual
 * (admin) bookings skip all of this — bookings.ts's /manual and PUT /:id routes
 * never pass a location, so scheduleFor's checks don't apply to them. Matched
 * by name because there is no service "type" column — services are edited
 * freely in the catalog, so tolerate spacing/case ("Coffee & Talk", "coffee&talk").
 */
export function isCoffeeTalkService(service: { name: string } | null | undefined): boolean {
  return !!service && /^\s*coffee\s*(&|and)\s*talk\b/i.test(service.name);
}
