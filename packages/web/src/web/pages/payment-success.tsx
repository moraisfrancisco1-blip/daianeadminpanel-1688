import { useEffect, useState } from "react";
import { Confetti } from "../components/confetti";

/**
 * PUBLIC post-payment landing page (FASE 2/4/5/6/13).
 *
 * This page is intentionally NOT wrapped in <Protected> and never touches the
 * auth middleware — a client who has just paid is never logged into the Admin
 * Panel. It is reached from Stripe's success_url:
 *   /payment-success?session_id={CHECKOUT_SESSION_ID}
 *
 * Security (FASE 3): we do NOT trust the query string to decide whether the
 * payment succeeded. The session_id is re-verified server-side against Stripe
 * via GET /api/payments/checkout-session/:sessionId, and only Stripe's own
 * payment_status/checkout status can render the "confirmed" state.
 */

type SessionInfo = {
  found: boolean;
  confirmed: boolean;
  paymentStatus: string;
  checkoutStatus: string;
  amount: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  invoiceNumber: string | null;
  serviceName: string | null;
  date: string | null;
  startTime: string | null;
  googleReviewUrl: string | null;
};

function formatMoney(amount: number, currency: string): string {
  const symbol = currency.toLowerCase() === "eur" ? "€" : currency.toUpperCase() + " ";
  return `${symbol}${amount.toFixed(2)}`;
}

function formatWhen(date: string | null, startTime: string | null): string | null {
  if (!date) return null;
  try {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(y!, m! - 1, d!);
    const day = dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return startTime ? `${day} · ${startTime}` : day;
  } catch {
    return startTime ? `${date} · ${startTime}` : date;
  }
}

/** Elegant, lightweight SVG "tick in a completing circle" with a soft glow. */
function ConfirmAnimation() {
  return (
    <div className="ps-halo-wrap">
      <div className="ps-halo" aria-hidden />
      <svg viewBox="0 0 120 120" className="ps-check-svg" aria-hidden="true">
        <circle className="ps-ring" cx="60" cy="60" r="52" />
        <path className="ps-tick" d="M38 62 L53 77 L84 44" />
      </svg>
      <span className="ps-spark ps-spark-1" aria-hidden />
      <span className="ps-spark ps-spark-2" aria-hidden />
      <span className="ps-spark ps-spark-3" aria-hidden />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">{label}</span>
      <span
        className={`text-sm text-right ${strong ? "font-display text-base text-brand-teal" : "text-brand-teal/90"}`}
      >
        {value}
      </span>
    </div>
  );
}


export default function PaymentSuccessPage() {
  const [state, setState] = useState<"loading" | "confirmed" | "processing" | "error">("loading");
  const [info, setInfo] = useState<SessionInfo | null>(null);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) {
      setState("error");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/payments/checkout-session/${encodeURIComponent(sessionId)}`);
        const data = (await res.json()) as SessionInfo & { message?: string };
        if (cancelled) return;
        if (!res.ok || !data.found) {
          setState("error");
          return;
        }
        setInfo(data);
        setState(data.confirmed ? "confirmed" : "processing");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const firstName = info?.customerName ? info.customerName.split(" ")[0] : null;
  const when = formatWhen(info?.date ?? null, info?.startTime ?? null);

  return (
    <div className="min-h-screen bg-brand-cream flex flex-col">
      <style>{PS_STYLES}</style>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <img
            src="/brand/logo-dark.png"
            alt="Studio Daï Oakes"
            className="w-full max-w-[190px] mx-auto h-auto mb-8 ps-fade"
          />

          <div className="bg-white border border-brand-tan/25 rounded-2xl shadow-[0_18px_50px_-24px_rgba(46,82,82,0.45)] px-6 py-9 sm:px-8 text-center">
            {state === "loading" && (
              <div className="py-10 flex flex-col items-center gap-4">
                <div className="size-14 rounded-full border-2 border-brand-tan/30 border-t-brand-copper animate-spin" />
                <p className="text-sm text-muted-foreground tracking-wide">Confirming your payment…</p>
              </div>
            )}

            {state === "confirmed" && info && (
              <>
                <Confetti />
                <ConfirmAnimation />
                <p className="mt-6 text-[11px] tracking-[0.28em] text-brand-copper font-medium ps-fade ps-d1">
                  PAYMENT CONFIRMED
                </p>
                <h1 className="mt-2 font-display text-2xl sm:text-[28px] text-brand-teal leading-snug ps-fade ps-d2">
                  Thank you{firstName ? `, ${firstName}` : ""}.
                </h1>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed ps-fade ps-d2">
                  Your payment has been successfully received.
                </p>

                <div className="mt-7 bg-brand-beige/45 rounded-xl p-5 text-left space-y-3 ps-fade ps-d3">
                  {info.serviceName && <Row label="Service" value={info.serviceName} />}
                  {when && <Row label="Appointment" value={when} />}
                  {info.invoiceNumber && <Row label="Invoice" value={info.invoiceNumber} />}
                  <Row label="Amount" value={formatMoney(info.amount, info.currency)} strong />
                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Payment status</span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4C7A56] bg-[#4C7A56]/10 rounded-full px-3 py-1">
                      <span className="size-1.5 rounded-full bg-[#4C7A56]" /> Paid
                    </span>
                  </div>
                </div>

                <p className="mt-6 font-accent text-lg text-brand-teal italic ps-fade ps-d4">
                  {info.serviceName || info.date ? "Your appointment is confirmed." : "Everything is settled — thank you."}
                </p>

                {info.googleReviewUrl && (
                  <div className="mt-8 pt-7 border-t border-brand-tan/20 ps-fade ps-d4">
                    <p className="text-[11px] tracking-[0.24em] text-brand-copper font-medium">
                      ENJOYED YOUR EXPERIENCE?
                    </p>
                    <p className="mt-1.5 text-sm text-muted-foreground">We'd love to hear from you.</p>
                    <a
                      href={info.googleReviewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-full bg-brand-teal text-brand-cream text-sm font-medium tracking-wide hover:bg-brand-teal-dark transition-colors"
                    >
                      <span className="text-brand-gold">★</span> Leave us a Google Review
                    </a>
                  </div>
                )}
              </>
            )}
            {state === "processing" && info && (
              <>
                <div className="mx-auto size-16 rounded-full bg-brand-beige/60 flex items-center justify-center">
                  <div className="size-7 rounded-full border-2 border-brand-tan/40 border-t-brand-copper animate-spin" />
                </div>
                <h1 className="mt-6 font-display text-2xl text-brand-teal">Payment is being processed</h1>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  We're waiting for your bank to confirm the payment. This usually takes a few moments — you can safely
                  close this page. A confirmation email will follow once it clears.
                </p>
                <div className="mt-6 bg-brand-beige/45 rounded-xl p-5 text-left space-y-3">
                  {info.serviceName && <Row label="Service" value={info.serviceName} />}
                  {when && <Row label="Appointment" value={when} />}
                  <Row label="Amount" value={formatMoney(info.amount, info.currency)} strong />
                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">Payment status</span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-copper bg-brand-copper/10 rounded-full px-3 py-1">
                      <span className="size-1.5 rounded-full bg-brand-copper animate-pulse" /> Processing
                    </span>
                  </div>
                </div>
              </>
            )}

            {state === "error" && (
              <>
                <div className="mx-auto size-16 rounded-full bg-brand-beige/60 flex items-center justify-center">
                  <span className="font-display text-2xl text-brand-copper">?</span>
                </div>
                <h1 className="mt-6 font-display text-2xl text-brand-teal">We couldn't confirm that payment</h1>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  If you just completed a payment, please allow a few moments and check your email for a confirmation.
                  If you were charged and don't receive one, contact us and we'll sort it out right away.
                </p>
                <a
                  href="mailto:daianeoakes@gmail.com"
                  className="mt-6 inline-flex items-center justify-center px-6 py-3 rounded-full bg-brand-copper text-white text-sm font-medium tracking-wide hover:bg-brand-copper/90 transition-colors"
                >
                  Contact Studio Daï Oakes
                </a>
              </>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground/70">Studio Daï Oakes · daianeoakes.com</p>
        </div>
      </main>
    </div>
  );
}

// Scoped keyframes for the subtle, premium check-mark celebration. The circle
// draws itself, the tick follows, a soft peach/gold glow breathes behind it and
// three tiny sparks fade in and out. Pure CSS/SVG, zero external assets, and
// fully disabled under prefers-reduced-motion. The canvas confetti burst
// (<Confetti />, mounted alongside this) has its own reduced-motion check.
const PS_STYLES = `
.ps-halo-wrap { position: relative; width: 116px; height: 116px; margin: 0 auto; }
.ps-halo {
  position: absolute; inset: -6px; border-radius: 9999px;
  background: radial-gradient(circle at 50% 50%, rgba(209,192,111,0.42), rgba(235,223,207,0.25) 45%, rgba(235,223,207,0) 70%);
  animation: ps-breathe 3.4s ease-in-out infinite;
}
.ps-check-svg { position: relative; width: 116px; height: 116px; overflow: visible; }
.ps-ring {
  fill: none; stroke: #2e5252; stroke-width: 3; stroke-linecap: round;
  stroke-dasharray: 327; stroke-dashoffset: 327; transform-origin: 60px 60px;
  animation: ps-draw-ring 1s cubic-bezier(.65,0,.35,1) forwards;
}
.ps-tick {
  fill: none; stroke: #4C7A56; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 70; stroke-dashoffset: 70;
  animation: ps-draw-tick .55s cubic-bezier(.65,0,.35,1) .72s forwards;
}
.ps-spark { position: absolute; border-radius: 9999px; background: #d1c06f; opacity: 0; }
.ps-spark-1 { width: 6px; height: 6px; top: 4px; right: 12px; animation: ps-spark 2.6s ease-in-out 1.1s infinite; }
.ps-spark-2 { width: 4px; height: 4px; bottom: 16px; left: 2px; animation: ps-spark 2.6s ease-in-out 1.5s infinite; }
.ps-spark-3 { width: 5px; height: 5px; top: 30px; left: -2px; animation: ps-spark 2.6s ease-in-out 1.9s infinite; }
@keyframes ps-draw-ring { to { stroke-dashoffset: 0; } }
@keyframes ps-draw-tick { to { stroke-dashoffset: 0; } }
@keyframes ps-breathe { 0%,100% { opacity: .55; transform: scale(.96); } 50% { opacity: 1; transform: scale(1.04); } }
@keyframes ps-spark { 0%,100% { opacity: 0; transform: scale(.6); } 50% { opacity: .9; transform: scale(1); } }
.ps-fade { opacity: 0; animation: ps-fade-up .6s ease forwards; }
.ps-d1 { animation-delay: .55s; } .ps-d2 { animation-delay: .7s; }
.ps-d3 { animation-delay: .85s; } .ps-d4 { animation-delay: 1s; }
@keyframes ps-fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  .ps-ring, .ps-tick { animation-duration: .01s; animation-delay: 0s; }
  .ps-halo, .ps-spark { animation: none; }
  .ps-fade { animation-duration: .01s; }
}
`;

