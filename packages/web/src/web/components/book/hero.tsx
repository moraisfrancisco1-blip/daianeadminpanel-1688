export function BookHero() {
  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/brand/hero.jpg)" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-brand-teal-dark/90 via-brand-teal/85 to-brand-teal" />
      <div className="relative max-w-3xl mx-auto px-4 py-16 text-center">
        <img src="/brand/logo.png" alt="Studio Daï Oakes" className="w-full max-w-[240px] mx-auto h-auto mb-6" />
        <p className="font-accent italic text-brand-gold text-xl md:text-2xl mb-3">
          Intelligent Care. Real Listening. True Respect.
        </p>
        <p className="text-brand-cream/85 text-sm md:text-base max-w-xl mx-auto leading-relaxed">
          Book your session with Daï Oakes — Women's Recovery &amp; Clinical Pilates specialist, based in Rotterdam.
        </p>

        <div className="grid grid-cols-4 gap-2 md:gap-6 mt-10 max-w-lg mx-auto">
          <Stat value="20+" label="Years of experience" />
          <Stat value="5" label="Languages spoken" />
          <Stat value="3" label="Countries of practice" />
          <Stat value="∞" label="Lives transformed" />
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-display text-2xl md:text-3xl text-brand-gold">{value}</p>
      <p className="text-[10px] md:text-xs text-brand-cream/70 uppercase tracking-wide mt-1">{label}</p>
    </div>
  );
}
