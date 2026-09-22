/**
 * The free intake call is the one service with its own weekday rule: unlike
 * every other service (which follows its location's regular days — Rotterdam
 * Mon/Wed/Fri, Amsterdam Tue/Thu — and, as of the Amsterdam-exclusivity being
 * dropped, Rotterdam can also use Tue/Thu), Coffee & Talk is only offered on
 * Tuesdays and Thursdays, for either location. Matched by name because there
 * is no service "type" column — services are edited freely in the catalog,
 * so tolerate spacing/case ("Coffee & Talk", "coffee&talk").
 */
export function isCoffeeTalkService(service: { name: string } | null | undefined): boolean {
  return !!service && /^\s*coffee\s*(&|and)\s*talk\b/i.test(service.name);
}
