import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { CalendarDays, Sparkles, AlertCircle, MapPin } from "lucide-react";
import { BookHero } from "../components/book/hero";
import { WhySection } from "../components/book/why-section";
import { FaqSection } from "../components/book/faq-section";
import { TestimonialsSection } from "../components/book/testimonials-section";
import { PolicySection } from "../components/book/policy-section";
import { LocationSection } from "../components/book/location-section";
import { ServiceSelector } from "../components/book/service-selector";
import { TermsCheckbox } from "../components/book/terms-checkbox";
import { isCoffeeTalkService } from "../../api/lib/coffee-talk";
import { validateBookingDetails, type BookingDetailField } from "../../api/lib/booking-details";

const COUNTRY_SUGGESTIONS = ["Netherlands", "Belgium", "Germany", "Portugal", "Brazil", "Spain", "France", "United Kingdom"];

const EMPTY_DETAILS: Record<BookingDetailField, string> = {
  name: "", email: "", phone: "", address: "", zipCode: "", city: "", country: "",
};

// A labelled, required field with its own error line.
function BookingField(props: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={props.id} className="text-sm font-medium mb-1 block text-brand-teal">
        {props.label} <span className="text-destructive" aria-hidden="true">*</span>
      </label>
      {props.children}
      {props.error && (
        <p id={`${props.id}-error`} className="text-xs text-destructive mt-1">
          {props.error}
        </p>
      )}
    </div>
  );
}

const inputClass = (invalid: boolean) =>
  `w-full h-10 px-3 rounded-md border bg-background text-sm ${invalid ? "border-destructive" : "border-input"}`;

const LOCATION_DAYS: Record<"rotterdam" | "amsterdam", number[]> = {
  rotterdam: [1, 3, 5],
  amsterdam: [2, 4],
};

// Coffee & Talk with Rotterdam is also open on Tue/Thu, i.e. every working weekday.
function nextWorkDays(count: number, location: "rotterdam" | "amsterdam", coffeeTalk: boolean): string[] {
  const dates: string[] = [];
  const d = new Date();
  const workDays = coffeeTalk && location === "rotterdam" ? [1, 2, 3, 4, 5] : LOCATION_DAYS[location];
  while (dates.length < count) {
    d.setDate(d.getDate() + 1);
    if (workDays.includes(d.getDay())) dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export default function BookPage() {
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [location, setLocation] = useState<"rotterdam" | "amsterdam">("rotterdam");
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [touched, setTouched] = useState<Partial<Record<BookingDetailField, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
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
    queryKey: ["availability", date, serviceId, location],
    enabled: !!date && !!serviceId,
    queryFn: async () =>
      (
        await api.bookings.availability.$get({
          query: { date, serviceId: String(serviceId), location },
        })
      ).json(),
  });

  const selectedService = services.data?.services.find((s) => s.id === serviceId);
  const isFree = selectedService?.price === 0;
  const coffeeTalk = isCoffeeTalkService(selectedService);
  const dates = nextWorkDays(9, location, coffeeTalk);
  const rotterdamAllWeek = coffeeTalk && location === "rotterdam";

  // Re-pick a date when the location (or a service with different days) changes so it's never stale.
  useEffect(() => {
    setDate("");
    setTime("");
  }, [location, coffeeTalk]);

  // Pre-select a service when arriving via a direct link, e.g. /book?service=8
  // (used for per-service buttons on the main website). The `serviceId !== null`
  // guard below makes this a no-op once a service is picked, so it's safe to
  // also re-run on `serviceId` changes.
  useEffect(() => {
    if (serviceId !== null || !services.data?.services.length) return;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("service");
    if (!requested) return;
    const match = services.data.services.find((s) => s.id === Number(requested));
    if (match) setServiceId(match.id);
  }, [services.data, serviceId]);

  useEffect(() => {
    if (serviceId && detailsRef.current) {
      detailsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [serviceId]);

  const validation = validateBookingDetails(details);
  // An error shows once a field has been left, or after trying to submit.
  const errorFor = (f: BookingDetailField) => (attempted || touched[f] ? validation.errors[f] : undefined);
  const setField = (f: BookingDetailField) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDetails((d) => ({ ...d, [f]: e.target.value }));
  const touch = (f: BookingDetailField) => () => setTouched((t) => ({ ...t, [f]: true }));
  const fieldProps = (f: BookingDetailField, autoComplete: string) => ({
    id: `book-${f}`,
    value: details[f],
    onChange: setField(f),
    onBlur: touch(f),
    autoComplete,
    required: true,
    "aria-invalid": errorFor(f) ? true : undefined,
    "aria-describedby": errorFor(f) ? `book-${f}-error` : undefined,
    className: inputClass(!!errorFor(f)),
  });

  async function handleSubmit() {
    if (!serviceId || !date || !time || !termsAccepted) return;
    setAttempted(true);
    if (!validation.ok) {
      setError("Please fill in all the required details.");
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await api.bookings.$post({
        json: { serviceId, date, startTime: time, location, payFullNow: true, ...validation.values },
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

        <div className="bg-white border border-brand-tan/30 rounded-lg p-6 space-y-5 shadow-sm">
          <div>
            <label className="text-sm font-medium mb-1.5 block text-brand-teal">Choose a service</label>
            <ServiceSelector services={services.data?.services ?? []} selectedId={serviceId} onSelect={setServiceId} />
          </div>

          {serviceId && (
            <div ref={detailsRef} className="space-y-5 scroll-mt-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block flex items-center gap-1.5 text-brand-teal">
                  <MapPin className="size-4" /> Location
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setLocation("rotterdam")}
                    className={`h-10 rounded-md text-sm border ${
                      location === "rotterdam" ? "bg-brand-teal text-white border-brand-teal" : "border-input bg-background"
                    }`}
                  >
                    {coffeeTalk ? "Rotterdam (Mon–Fri)" : "Rotterdam (Mon/Wed/Fri)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocation("amsterdam")}
                    className={`h-10 rounded-md text-sm border ${
                      location === "amsterdam" ? "bg-brand-teal text-white border-brand-teal" : "border-input bg-background"
                    }`}
                  >
                    Amsterdam (Tue/Thu)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block flex items-center gap-1.5 text-brand-teal">
                  <CalendarDays className="size-4" />
                  {location === "amsterdam"
                    ? "Date (Tue / Thu)"
                    : rotterdamAllWeek
                      ? "Date (Mon – Fri)"
                      : "Date (Mon / Wed / Fri, 10:00–18:00)"}
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
                  ) : availability.data && "message" in availability.data ? (
                    <p className="text-sm text-destructive">{availability.data.message}</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-2">
                      {((availability.data && "slots" in availability.data ? availability.data.slots : []) ?? []).map((s) => (
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
                      {((availability.data && "slots" in availability.data ? availability.data.slots : []) ?? []).length === 0 && (
                        <p className="col-span-4 text-sm text-muted-foreground">No slots available this day.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3">
                <BookingField id="book-name" label="Full name" error={errorFor("name")}>
                  <input aria-label="Full name" placeholder="First and last name" {...fieldProps("name", "name")} />
                </BookingField>
                <BookingField id="book-email" label="Email" error={errorFor("email")}>
                  <input aria-label="Email" type="email" inputMode="email" placeholder="you@example.com" {...fieldProps("email", "email")} />
                </BookingField>
                <BookingField id="book-phone" label="Phone" error={errorFor("phone")}>
                  <input aria-label="Phone" type="tel" inputMode="tel" placeholder="+31 6 12345678" {...fieldProps("phone", "tel")} />
                </BookingField>
                <BookingField id="book-address" label="Street and house number" error={errorFor("address")}>
                  <input aria-label="Street and house number" placeholder="Street 12" {...fieldProps("address", "address-line1")} />
                </BookingField>
                <div className="grid grid-cols-[1fr_1.6fr] gap-3">
                  <BookingField id="book-zipCode" label="Postcode" error={errorFor("zipCode")}>
                    <input aria-label="Postcode" placeholder="1234 AB" {...fieldProps("zipCode", "postal-code")} />
                  </BookingField>
                  <BookingField id="book-city" label="City" error={errorFor("city")}>
                    <input aria-label="City" placeholder="Rotterdam" {...fieldProps("city", "address-level2")} />
                  </BookingField>
                </div>
                <BookingField id="book-country" label="Country" error={errorFor("country")}>
                  <input aria-label="Country" list="book-country-options" placeholder="Netherlands" {...fieldProps("country", "country-name")} />
                </BookingField>
                <datalist id="book-country-options" aria-label="Country suggestions">
                  {COUNTRY_SUGGESTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  All fields are required. We use your details for your booking confirmation and invoice.
                </p>
              </div>

              {!isFree && (
                <div className="bg-brand-beige/60 rounded-lg p-4 space-y-1">
                  <p className="text-sm font-medium text-brand-teal">
                    Pay in full to confirm {selectedService && `(€${selectedService.price.toFixed(2)})`}
                  </p>
                  <p className="text-xs text-muted-foreground">
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
                disabled={!serviceId || !date || !time || !termsAccepted || submitting}
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
