type WatchSeverity = "critical" | "high" | "medium" | "low" | "info";

type WatchEvent = {
  severity: WatchSeverity;
  eventType: string;
  title: string;
  message: string;
  source?: string;
  metadata?: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 2500;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_TITLE_LENGTH = 255;
const MAX_METADATA_KEYS = 12;

function enabled(): boolean {
  return process.env.VOLT_WATCH_ENABLED === "true"
    && Boolean(process.env.VOLT_WATCH_URL)
    && Boolean(process.env.VOLT_WATCH_KEY);
}

function cleanText(value: unknown, maxLength: number): string {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return text.slice(0, maxLength);
}

function cleanMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata).slice(0, MAX_METADATA_KEYS)) {
    if (/authorization|cookie|token|secret|password|email|phone/i.test(key)) continue;
    if (typeof value === "string") result[key] = cleanText(value, 300);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) result[key] = value;
  }
  return Object.keys(result).length ? result : undefined;
}

export function reportVoltWatchEvent(event: WatchEvent): void {
  if (!enabled()) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const url = process.env.VOLT_WATCH_URL!.replace(/\/$/, "");

  void fetch(`${url}/api/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Volt-Key": process.env.VOLT_WATCH_KEY!,
    },
    signal: controller.signal,
    body: JSON.stringify({
      system_id: "daiane-oakes-admin",
      system_name: "Daiane Oakes Admin Panel",
      environment: process.env.VOLT_WATCH_ENVIRONMENT ?? "production",
      severity: event.severity,
      event_type: cleanText(event.eventType, 120),
      title: cleanText(event.title, MAX_TITLE_LENGTH),
      message: cleanText(event.message, MAX_MESSAGE_LENGTH),
      source: event.source ?? "admin-api",
      metadata: cleanMetadata(event.metadata),
    }),
  })
    .then((response) => {
      if (!response.ok) console.error("[volt-watch] event rejected", response.status);
    })
    .catch((err) => {
      console.error("[volt-watch] report failed", err instanceof Error ? err.message : err);
    })
    .finally(() => clearTimeout(timeout));
}
