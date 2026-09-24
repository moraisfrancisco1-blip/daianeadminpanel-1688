export const AMSTERDAM_TRAVEL_SURCHARGE = 25;

/**
 * Online bookings to Amsterdam carry a flat travel surcharge on top of the service's
 * own price. Free services (Coffee & Talk) are never surcharged — a call needs no travel.
 * Used everywhere an amount is charged or an invoice line is built for a booking, so the
 * three places that can end up billing an Amsterdam session (the Stripe checkout amount,
 * the webhook-created invoice, and an admin regenerating one via /generate-invoice) can
 * never drift apart.
 */
export function amsterdamSurcharge(location: string, servicePrice: number): number {
  return location === "amsterdam" && servicePrice > 0 ? AMSTERDAM_TRAVEL_SURCHARGE : 0;
}
