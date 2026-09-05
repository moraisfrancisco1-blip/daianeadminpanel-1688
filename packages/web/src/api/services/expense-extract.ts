import Anthropic from "@anthropic-ai/sdk";

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

export interface ExtractedExpense {
  supplier: string | null;
  category: string | null;
  invoiceNumber: string | null;
  issueDate: string | null; // YYYY-MM-DD
  netAmount: number | null;
  vatAmount: number | null;
  vatRate: number | null; // decimal, e.g. 0.21
  totalAmount: number | null;
}

const CATEGORIES = ["Telecom", "Software", "Advertising", "Domain/Hosting", "Office", "Travel", "Other"];

const PROMPT = `You are reading a business expense invoice/receipt (e.g. a phone bill, domain registration, ad spend invoice). Extract these fields and reply with ONLY a raw JSON object, no markdown fences, no commentary:

{
  "supplier": string or null,
  "category": one of ${JSON.stringify(CATEGORIES)} or null,
  "invoiceNumber": string or null,
  "issueDate": "YYYY-MM-DD" or null,
  "netAmount": number or null (amount excluding VAT),
  "vatAmount": number or null,
  "vatRate": number or null (as a decimal, e.g. 0.21 for 21%),
  "totalAmount": number or null (amount including VAT)
}

If a field truly cannot be determined, use null for it rather than guessing. If only the total and VAT rate are visible, compute netAmount and vatAmount from them. Numbers must be plain numbers (no currency symbols, no thousands separators).`;

function parseExtractedJson(text: string): ExtractedExpense {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  return {
    supplier: typeof parsed.supplier === "string" ? parsed.supplier : null,
    category: CATEGORIES.includes(parsed.category) ? parsed.category : null,
    invoiceNumber: typeof parsed.invoiceNumber === "string" ? parsed.invoiceNumber : null,
    issueDate: typeof parsed.issueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.issueDate) ? parsed.issueDate : null,
    netAmount: typeof parsed.netAmount === "number" ? parsed.netAmount : null,
    vatAmount: typeof parsed.vatAmount === "number" ? parsed.vatAmount : null,
    vatRate: typeof parsed.vatRate === "number" ? parsed.vatRate : null,
    totalAmount: typeof parsed.totalAmount === "number" ? parsed.totalAmount : null,
  };
}

/**
 * Reads a photographed/scanned expense invoice with Claude's vision and
 * returns best-effort structured fields for the admin to review and correct
 * before saving — this is a starting point for the form, never trusted blindly
 * for a number that ends up on a tax filing.
 */
export async function extractExpenseFromFile(fileBuffer: Buffer, mimeType: string): Promise<ExtractedExpense> {
  if (!anthropic) throw new Error("ANTHROPIC_API_KEY is not configured");

  const base64 = fileBuffer.toString("base64");
  const isPdf = mimeType === "application/pdf";

  const content: Anthropic.MessageParam["content"] = [
    isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/webp", data: base64 } },
    { type: "text", text: PROMPT },
  ];

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("No text in extraction response");
  return parseExtractedJson(textBlock.text);
}
