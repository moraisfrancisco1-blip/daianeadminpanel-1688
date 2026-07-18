const POINTS = [
  {
    title: "Master in Pelvic Floor",
    desc: "Postgraduate specialisation in Urogynaecology and Women's Health.",
  },
  {
    title: "Clinical Pilates Specialist",
    desc: "20+ years refining movement-based recovery across three countries.",
  },
  {
    title: "Expert in Core & Diastasis",
    desc: "A proprietary method — real reconnection before more compensation.",
  },
  {
    title: "Post Partum Recovery",
    desc: "For women weeks, months or decades after birth. It's never too late.",
  },
];

export function WhySection() {
  return (
    <section className="max-w-4xl mx-auto px-4 py-14">
      <div className="text-center mb-10">
        <p className="text-xs tracking-[0.2em] text-brand-copper font-medium mb-2">WHY DAÏ OAKES</p>
        <h2 className="font-display text-2xl md:text-3xl text-brand-teal">The Oakes Method™</h2>
        <p className="text-muted-foreground text-sm mt-3 max-w-xl mx-auto leading-relaxed">
          Not another viral exercise trend or rushed insurance-based care. A refined clinical method designed around
          the human body — and around you.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {POINTS.map((p) => (
          <div key={p.title} className="bg-white border border-brand-tan/25 rounded-lg p-4 text-center">
            <p className="font-display text-sm text-brand-teal mb-1.5">{p.title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
