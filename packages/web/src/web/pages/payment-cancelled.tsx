/**
 * PUBLIC payment-cancelled landing page (FASE 10).
 *
 * Reached from Stripe's cancel_url (/payment-cancelled) when a client leaves
 * Checkout without paying. Like /payment-success it is NOT wrapped in
 * <Protected> and never redirects to /login — a client must never be pushed
 * into the Admin Panel. It does NOT alter any financial state: the invoice /
 * booking simply stays unpaid, exactly as Stripe left it.
 */
export default function PaymentCancelledPage() {
  return (
    <div className="min-h-screen bg-brand-cream flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <img
            src="/brand/logo-dark.png"
            alt="Studio Daï Oakes"
            className="w-full max-w-[190px] mx-auto h-auto mb-8"
          />

          <div className="bg-white border border-brand-tan/25 rounded-2xl shadow-[0_18px_50px_-24px_rgba(46,82,82,0.45)] px-6 py-9 sm:px-8">
            <div className="mx-auto size-16 rounded-full bg-brand-beige/60 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="size-7 text-brand-copper" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5" />
                <path d="M12 16h.01" />
              </svg>
            </div>

            <h1 className="mt-6 font-display text-2xl text-brand-teal leading-snug">Payment was not completed</h1>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              No worries — nothing was charged and your booking has <strong className="text-brand-teal">not</strong> been
              marked as paid. You can pick up where you left off whenever you're ready.
            </p>

            <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
              <a
                href="/book"
                className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-brand-copper text-white text-sm font-medium tracking-wide hover:bg-brand-copper/90 transition-colors"
              >
                Return to booking
              </a>
              <a
                href="mailto:daianeoakes@gmail.com"
                className="inline-flex items-center justify-center px-6 py-3 rounded-full border border-brand-tan/40 text-brand-teal text-sm font-medium tracking-wide hover:bg-brand-beige/40 transition-colors"
              >
                Need help? Contact us
              </a>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground/70">Studio Daï Oakes · daianeoakes.com</p>
        </div>
      </main>
    </div>
  );
}
