import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { CalendarDays, Sparkles, AlertCircle } from "lucide-react";
import { BookHero } from "../components/book/hero";
import { WhySection } from "../components/book/why-section";
import { FaqSection } from "../components/book/faq-section";
import { TestimonialsSection } from "../components/book/testimonials-section";
import { PolicySection } from "../components/book/policy-section";
import { LocationSection } from "../components/book/location-section";
import { ServiceSelector } from "../components/book/service-selector";
import { TermsCheckbox } from "../components/book/terms-checkbox";

const WORK_DAYS = [1, 3, 5];

function nextWorkDays(count: number): string[] {
  const dates: string[] = [];
  const d = new Date();
  while (dates.length < count) {
    d.setDate(d.getDate() + 1);
    if (WORK_DAYS.includes(d.getDay())) dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export default function BookPage() {
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [payFullNow, setPayFullNow] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmedFree, setConfirmedFree] = useState(false);
  const [error, setError] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);

  const detailsRef = useRef<HTMLDivElement>(null);

  const services = useQuery({
    queryKey: ["public-services"],
    queryFn: async () => (await api.services.$get({ query: { active: "true" } })).json(),
  });

  const availability = useQuery({
    queryKey: ["availability", date, serviceId],
    enabled: !!date && !!serviceId,
    queryFn: async () =>
      (
        await api.bookings.availability.$get({
          query: { date, serviceId: String(serviceId) },
        })
      ).json(),
  });

  const selectedService = services.data?.services.find((s) => s.id === serviceId);
  const isFree = selectedService?.price === 0;
  const dates = nextWorkDays(9);

  // Pre-select a service when arriving via a direct link, e.g. /book?service=8
  // (used for per-service buttons on the main website).
  useEffect(() => {
    if (serviceId !== null || !services.data?.services.length) return;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("service");
    if (!requested) return;
    const match = services.data.services.find((s) => s.id === Number(requested));
    if (match) setServiceId(match.id);
  }, [services.data]);

  useEffect(() => {
    if (serviceId && detailsRef.current) {
      detailsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [serviceId]);

  async function handleSubmit() {
    if (!serviceId || !date || !time || !name || !email || !termsAccepted) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await api.bookings.$post({
        json: { serviceId, date, startTime: time, payFullNow, name, email, phone },
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as any)?.message ?? "Something went wrong. Please try again.");
        return;
      }
      if ("checkoutUrl" in data && data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
      } else if ("free" in data && data.free) {
        setConfirmedFree(true);
      } else {
        setError("Could not start payment. Please try again or contact us directly.");
      }
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmedFree) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <img src="/brand/logo-dark.png" alt="Studio Daï Oakes" className="w-full max-w-[200px] mx-auto h-auto mb-6" />
          <h1 className="font-display text-xl text-brand-teal mb-2 tracking-wide">Booking Confirmed</h1>
          <p className="text-muted-foreground text-sm">
            Your Coffee &amp; Talk is booked for {date} at {time}. You'll receive a confirmation email shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-cream">
      <BookHero />
      <WhySection />

      {/* Booking widget */}
      <section id="booking" className="max-w-lg mx-auto px-4 py-8">
        <div className="text-center mb-6">
          <p className="text-xs tracking-[0.2em] text-brand-copper font-medium mb-2">BOOK NOW</p>
          <h2 className="font-display text-2xl md:text-3xl text-brand-teal">Reserve Your Session</h2>
        </div>

        <a
          href="https://wa.me/31611660722?text=Hi%20Da%C3%AF%2C%20I%27d%20like%20to%20book%20a%20session%20%E2%80%94%20could%20you%20help%20me%20find%20a%20time%3F"
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 w-full h-11 mb-6 rounded-lg bg-[#25D366] text-white font-medium text-sm hover:bg-[#20bd5a] transition-colors"
        >
          <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
            <path d="M12.004 2.003c-5.514 0-9.997 4.483-9.997 9.997 0 1.762.462 3.484 1.34 5.001L2 22l5.116-1.34a9.958 9.958 0 0 0 4.888 1.272h.004c5.514 0 9.997-4.483 9.997-9.997 0-2.67-1.04-5.18-2.928-7.069a9.935 9.935 0 0 0-7.073-2.863zm5.848 15.845a8.297 8.297 0 0 1-5.848 2.421h-.003a8.28 8.28 0 0 1-4.222-1.155l-.303-.18-3.037.796.81-2.96-.197-.304a8.264 8.264 0 0 1-1.267-4.446c0-4.582 3.73-8.312 8.316-8.312a8.26 8.26 0 0 1 5.878 2.437 8.26 8.26 0 0 1 2.432 5.88 8.297 8.297 0 0 1-2.559 5.822z" />
          </svg>
          Book via WhatsApp instead
        </a>

        <div className="bg-white border border-brand-tan/30 rounded-lg p-6 space-y-5 shadow-sm">
          <div>
            <label className="text-sm font-medium mb-1.5 block text-brand-teal">Choose a service</label>
            <ServiceSelector services={services.data?.services ?? []} selectedId={serviceId} onSelect={setServiceId} />
          </div>

          {serviceId && (
            <div ref={detailsRef} className="space-y-5 scroll-mt-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block flex items-center gap-1.5 text-brand-teal">
                  <CalendarDays className="size-4" /> Date (Mon / Wed / Fri, 10:00–18:00)
                </label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setTime("");
                  }}
                >
                  <option value="">Select a date…</option>
                  {dates.map((d) => (
                    <option key={d} value={d}>
                      {new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}
                    </option>
                  ))}
                </select>
              </div>

              {date && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block text-brand-teal">Time slot</label>
                  {availability.isLoading ? (
                    <div className="h-10 rounded-md bg-muted animate-pulse" />
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {(availability.data?.slots ?? []).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setTime(s)}
                          className={`h-9 rounded-md text-sm border ${
                            time === s ? "bg-brand-teal text-white border-brand-teal" : "border-input bg-background"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                      {(availability.data?.slots ?? []).length === 0 && (
                        <p className="col-span-4 text-sm text-muted-foreground">No slots available this day.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3">
                <input
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                />
                <input
                  placeholder="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                />
                <input
                  placeholder="Phone (optional)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                />
              </div>

              {!isFree && (
                <div className="bg-brand-beige/60 rounded-lg p-4 space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" checked={!payFullNow} onChange={() => setPayFullNow(false)} />
                    Pay €25 deposit now, rest at session
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" checked={payFullNow} onChange={() => setPayFullNow(true)} />
                    Pay in full now {selectedService && `(€${selectedService.price.toFixed(2)})`}
                  </label>
                  <p className="text-xs text-muted-foreground pt-1">
                    You'll choose your payment method (card, iDEAL, and more) securely on the next screen.
                  </p>
                </div>
              )}

              <TermsCheckbox checked={termsAccepted} onChange={setTermsAccepted} />

              {error && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-3">
                  <AlertCircle className="size-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                className="w-full bg-brand-copper hover:bg-brand-copper/90 text-white tracking-wide"
                disabled={!serviceId || !date || !time || !name || !email || !termsAccepted || submitting}
                onClick={handleSubmit}
              >
                <Sparkles className="size-4" />
                {submitting ? "Processing…" : isFree ? "Confirm Booking" : "Confirm & Pay"}
              </Button>
            </div>
          )}
        </div>
      </section>

      <FaqSection />
      <TestimonialsSection />
      <PolicySection />
      <LocationSection />

      <footer className="bg-brand-teal-dark py-6 text-center text-brand-cream/50 text-xs">
        © {new Date().getFullYear()} Studio Daï Oakes · daianeoakes.com
      </footer>
    </div>
  );
}
