import { Clock, ShieldCheck, CalendarClock } from "lucide-react";

export function PolicySection() {
  return (
    <section className="max-w-3xl mx-auto px-4 py-14">
      <div className="text-center mb-8">
        <p className="text-xs tracking-[0.2em] text-brand-copper font-medium mb-2">GOOD TO KNOW</p>
        <h2 className="font-display text-2xl md:text-3xl text-brand-teal">Booking &amp; Cancellation Policy</h2>
      </div>
      <div className="grid md:grid-cols-3 gap-5">
        <PolicyCard
          icon={CalendarClock}
          title="24h Notice"
          desc="Reschedule or cancel free of charge up to 24 hours before your session."
        />
        <PolicyCard
          icon={ShieldCheck}
          title="Deposit Secures Your Slot"
          desc="A €25 deposit (or full payment) confirms your booking. Late cancellations may forfeit it."
        />
        <PolicyCard
          icon={Clock}
          title="Please Arrive on Time"
          desc="Sessions start and end on schedule out of respect for every woman's time — yours and the next client's."
        />
      </div>
    </section>
  );
}

function PolicyCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="bg-brand-beige/50 rounded-lg p-5 text-center">
      <Icon className="size-6 text-brand-copper mx-auto mb-3" />
      <p className="font-display text-sm text-brand-teal mb-1.5">{title}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}
