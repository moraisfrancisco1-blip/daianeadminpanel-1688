import { Quote } from "lucide-react";

const TESTIMONIALS = [
  {
    quote:
      "I arrived not knowing what was wrong with my body, just that something wasn't right. Daï was the first person who truly listened.",
    name: "S.",
    context: "Postpartum recovery",
  },
  {
    quote:
      "My diastasis had bothered me for years. In one session I understood more about my own body than in years of generic advice.",
    name: "M.",
    context: "Core & Diastasis",
  },
  {
    quote:
      "Clinical, warm, and precise. Pilates with Daï is nothing like a gym class — it's the first movement that ever actually helped.",
    name: "L.",
    context: "Clinical Pilates",
  },
];

export function TestimonialsSection() {
  return (
    <section className="max-w-4xl mx-auto px-4 py-14">
      <div className="text-center mb-10">
        <p className="text-xs tracking-[0.2em] text-brand-copper font-medium mb-2">CLIENT FEEDBACK</p>
        <h2 className="font-display text-2xl md:text-3xl text-brand-teal">What Women Say</h2>
      </div>
      <div className="grid md:grid-cols-3 gap-5">
        {TESTIMONIALS.map((t) => (
          <div key={t.name} className="bg-white border border-brand-tan/25 rounded-lg p-5">
            <Quote className="size-5 text-brand-gold mb-3" />
            <p className="text-sm text-brand-teal/90 italic leading-relaxed mb-4">"{t.quote}"</p>
            <p className="text-xs text-muted-foreground font-medium">
              {t.name} <span className="text-brand-copper">— {t.context}</span>
            </p>
          </div>
        ))}
      </div>
      <p className="text-center text-[11px] text-muted-foreground/70 mt-6 italic">
        Client initials used to protect privacy.
      </p>
    </section>
  );
}
