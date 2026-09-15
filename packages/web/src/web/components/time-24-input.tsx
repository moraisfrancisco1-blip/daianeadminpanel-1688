import { useEffect, useState } from "react";

/**
 * Native <input type="time"> renders 12h AM/PM or 24h purely based on the
 * OS's own region/locale setting (macOS: System Settings → Language & Region
 * → 24-Hour Time) — the page's `lang` attribute only affects this on some
 * browser/OS combinations (e.g. Chrome/Windows), not others (Safari/macOS,
 * mobile Safari). This is a plain masked text input instead, so the 24h
 * format is guaranteed everywhere regardless of the device's settings.
 */

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parses free-typed digits into a "HH:MM" 24h value, clamping out-of-range input. */
function normalizeTime(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  let hours: number;
  let minutes: number;
  if (digits.length <= 2) {
    hours = clamp(Number(digits), 0, 23);
    minutes = 0;
  } else {
    hours = clamp(Number(digits.slice(0, digits.length - 2)), 0, 23);
    minutes = clamp(Number(digits.slice(-2)), 0, 59);
  }
  return `${pad2(hours)}:${pad2(minutes)}`;
}

export function Time24Input({
  value,
  onChange,
  className,
}: {
  /** Committed value, "HH:MM" 24h. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      value={draft}
      onChange={(e) => {
        let next = e.target.value.replace(/[^0-9:]/g, "").slice(0, 5);
        if (next.length === 2 && !next.includes(":") && draft.length < next.length) {
          next += ":";
        }
        setDraft(next);
      }}
      onBlur={() => {
        const normalized = normalizeTime(draft) ?? value;
        setDraft(normalized);
        if (normalized !== value) onChange(normalized);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={className ?? "w-full h-10 px-3 rounded-md border border-input bg-background text-sm"}
    />
  );
}
