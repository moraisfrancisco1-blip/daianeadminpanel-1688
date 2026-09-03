import { useState } from "react";
import { X } from "lucide-react";

const TERMS_TEXT = `By booking a session with Studio Daï Oakes you agree to the following:

Booking & Cancellation Policy
• Reschedule or cancel free of charge up to 24 hours before your session.
• Full payment secures your slot — late cancellations or no-shows may forfeit it.
• Please arrive 15 minutes before your scheduled time.

Health & Responsibility
• Services offered are private-pay wellness/physiotherapy sessions and do not replace emergency medical care.
• You confirm that you have disclosed any relevant health conditions, pregnancy status, or injuries to Daï before your session.
• Studio Daï Oakes is not liable for pre-existing conditions not disclosed prior to a session.

Payments
• Payments are processed securely via Stripe. Payments are non-refundable in case of late cancellation (less than 24h notice) or no-show.

Privacy
• Your contact details are used only to manage your booking, invoicing, and studio communications — never shared with third parties.`;

export function TermsCheckbox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 shrink-0"
        />
        <span>
          I have read and agree to the{" "}
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="text-brand-copper underline font-medium"
          >
            Booking Terms &amp; Cancellation Policy
          </button>
          .
        </span>
      </label>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto relative">
            <button onClick={() => setShowModal(false)} className="absolute top-4 right-4 text-muted-foreground">
              <X className="size-4" />
            </button>
            <h2 className="font-display text-lg text-brand-teal mb-4">Booking Terms &amp; Cancellation Policy</h2>
            <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{TERMS_TEXT}</p>
          </div>
        </div>
      )}
    </>
  );
}
