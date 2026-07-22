import type { IncomingMessage, ServerResponse } from "node:http";
// @ts-expect-error generated at build time by `bun run build:api`
import app from "../dist-api/app.js";

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `${proto}://${host}`);

    const headers = new Headers();
    for (const [key, val] of Object.entries(req.headers)) {
      if (val === undefined) continue;
      headers.set(key, Array.isArray(val) ? val.join(", ") : val);
    }

    const method = req.method ?? "GET";
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await readBody(req) : undefined;

    const request = new Request(url, {
      method,
      headers,
      body: body && body.length > 0 ? body : undefined,
    });

    const response = await app.fetch(request);

    res.statusCode = response.status;
    response.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
    });
    const setCookies = response.headers.getSetCookie?.();
    if (setCookies?.length) res.setHeader("set-cookie", setCookies);

    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error("[api]", err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Internal Server Error" }));
  }
}
