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
const SYSTEM_NAME = "daiane-oakes-admin";

const LEVEL_BY_SEVERITY: Record<WatchSeverity, "CRITICAL" | "ERROR" | "WARNING" | "INFO"> = {
  critical: "CRITICAL",
  high: "ERROR",
  medium: "WARNING",
  low: "INFO",
  info: "INFO",
};

let registrationPromise: Promise<boolean> | null = null;

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

function buildMessage(event: WatchEvent): string {
  const metadata = cleanMetadata(event.metadata);
  const context = metadata ? ` | context=${JSON.stringify(metadata)}` : "";
  return cleanText(
    `[${cleanText(event.eventType, 120)}] ${cleanText(event.title, MAX_TITLE_LENGTH)}: ${cleanText(event.message, MAX_MESSAGE_LENGTH)}${context}`,
    MAX_MESSAGE_LENGTH,
  );
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function registerSystem(url: string, headers: Record<string, string>, environment: string): Promise<boolean> {
  if (registrationPromise) return registrationPromise;

  registrationPromise = fetchWithTimeout(`${url}/api/v1/systems`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: SYSTEM_NAME, environment }),
  })
    .then((response) => {
      if (!response.ok) {
        console.error("[volt-watch] system registration rejected", response.status);
        registrationPromise = null;
        return false;
      }
      return true;
    })
    .catch((err) => {
      console.error("[volt-watch] system registration failed", err instanceof Error ? err.message : err);
      registrationPromise = null;
      return false;
    });

  return registrationPromise;
}

export function reportVoltWatchEvent(event: WatchEvent): void {
  if (!enabled()) return;

  const url = process.env.VOLT_WATCH_URL!.replace(/\/$/, "");
  const environment = process.env.VOLT_WATCH_ENVIRONMENT ?? "production";
  const headers = {
    "Content-Type": "application/json",
    "X-Volt-Key": process.env.VOLT_WATCH_KEY!,
  };

  void (async () => {
    const registered = await registerSystem(url, headers, environment);
    if (!registered) return;

    const response = await fetchWithTimeout(`${url}/api/v1/watch/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        system: SYSTEM_NAME,
        level: LEVEL_BY_SEVERITY[event.severity],
        message: buildMessage(event),
      }),
    });

    if (!response.ok) console.error("[volt-watch] event rejected", response.status);
  })().catch((err) => {
    console.error("[volt-watch] report failed", err instanceof Error ? err.message : err);
  });
}
