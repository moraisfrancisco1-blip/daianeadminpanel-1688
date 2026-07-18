import { MapPin, Phone, Globe } from "lucide-react";

export function LocationSection() {
  return (
    <section className="bg-brand-teal">
      <div className="max-w-4xl mx-auto px-4 py-14 grid md:grid-cols-2 gap-8 items-center">
        <div>
          <p className="text-xs tracking-[0.2em] text-brand-gold font-medium mb-2">FIND US</p>
          <h2 className="font-display text-2xl md:text-3xl text-brand-cream mb-5">Based in Rotterdam</h2>
          <div className="space-y-4 text-brand-cream/85 text-sm">
            <div className="flex items-start gap-3">
              <MapPin className="size-4 mt-0.5 text-brand-gold shrink-0" />
              <span>Ommoordsweg 32, 3056 JP, Rotterdam</span>
            </div>
            <div className="flex items-start gap-3">
              <Phone className="size-4 mt-0.5 text-brand-gold shrink-0" />
              <span>+31 6 11 66 07 22</span>
            </div>
            <div className="flex items-start gap-3">
              <Globe className="size-4 mt-0.5 text-brand-gold shrink-0" />
              <span>English · Português · Français · Nederlands · Español · Italiano</span>
            </div>
          </div>
          <p className="text-brand-cream/60 text-xs mt-6 italic font-accent text-base">
            Serving women across the Netherlands and internationally online.
          </p>
        </div>
        <div className="rounded-lg overflow-hidden h-64 md:h-72 border border-white/10">
          <iframe
            title="Studio Daï Oakes location"
            width="100%"
            height="100%"
            style={{ border: 0 }}
            loading="lazy"
            src="https://www.google.com/maps?q=Ommoordsweg+32,+3056+JP+Rotterdam&output=embed"
          />
        </div>
      </div>
    </section>
  );
}
