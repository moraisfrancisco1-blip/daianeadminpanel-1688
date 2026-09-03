import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    q: "What happens in the first session?",
    a: "Most journeys start with a free Coffee & Talk (20 min) — no clinical setting, no commitment, just an honest conversation about what's going on and how I can help. From there, we plan the right service for your story.",
  },
  {
    q: "What should I bring or wear?",
    a: "Comfortable clothing you can move in. Sessions may include hands-on work, movement assessment, or Pilates — flexible activewear works best.",
  },
  {
    q: "Can I reschedule or cancel my booking?",
    a: "Yes — please give at least 24 hours' notice by replying to your confirmation email or calling. Cancellations with less notice may forfeit the session payment. See our full cancellation policy below.",
  },
  {
    q: "Do you accept insurance (verzekering)?",
    a: "Sessions are offered as private pay to allow the time and depth insurance-based care often doesn't. A receipt is provided for your own insurer if you'd like to submit it.",
  },
  {
    q: "Is online consultation available?",
    a: "Yes — Daï works with women across the Netherlands and internationally online, in English, Português, Français, Nederlands, Español or Italiano.",
  },
  {
    q: "What payment methods do you accept?",
    a: "Card and iDEAL, securely processed at the time of booking. Full payment secures your slot.",
  },
];

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="max-w-2xl mx-auto px-4 py-14">
      <div className="text-center mb-8">
        <p className="text-xs tracking-[0.2em] text-brand-copper font-medium mb-2">FAQ</p>
        <h2 className="font-display text-2xl md:text-3xl text-brand-teal">Frequently Asked Questions</h2>
      </div>
      <div className="space-y-2">
        {FAQS.map((item, i) => (
          <div key={item.q} className="bg-white border border-brand-tan/25 rounded-lg overflow-hidden">
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left"
            >
              <span className="text-sm font-medium text-brand-teal">{item.q}</span>
              <ChevronDown className={`size-4 text-brand-copper shrink-0 transition-transform ${open === i ? "rotate-180" : ""}`} />
            </button>
            {open === i && <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">{item.a}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
