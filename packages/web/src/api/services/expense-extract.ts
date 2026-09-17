import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const CATEGORIES = ["Telecom", "Software", "Advertising", "Domain/Hosting", "Office", "Travel", "Other"] as const;

const ExtractedExpenseSchema = z.object({
  supplier: z.string().nullable(),
  category: z.enum(CATEGORIES).nullable(),
  invoiceNumber: z.string().nullable(),
  issueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  netAmount: z.number().nullable(),
  vatAmount: z.number().nullable(),
  vatRate: z.number().nullable(),
  totalAmount: z.number().nullable(),
});

export type ExtractedExpense = z.infer<typeof ExtractedExpenseSchema>;

const PROMPT = `You are reading a business expense invoice/receipt (e.g. a phone bill, domain registration, ad spend invoice). Extract these fields:

- supplier
- category: one of ${JSON.stringify(CATEGORIES)}
- invoiceNumber
- issueDate: "YYYY-MM-DD"
- netAmount: amount excluding VAT
- vatAmount
- vatRate: as a decimal, e.g. 0.21 for 21%
- totalAmount: amount including VAT

If a field truly cannot be determined, use null for it rather than guessing. If only the total and VAT rate are visible, compute netAmount and vatAmount from them. Numbers must be plain numbers (no currency symbols, no thousands separators).`;

/**
 * Reads a photographed/scanned expense invoice with Claude's vision and
 * returns best-effort structured fields for the admin to review and correct
 * before saving — this is a starting point for the form, never trusted blindly
 * for a number that ends up on a tax filing.
 *
 * Uses the Messages API's structured-output mode (output_config.format) so
 * the response is guaranteed to match ExtractedExpenseSchema — no more
 * hand-rolled ```json fence stripping or JSON.parse that breaks the moment
 * the model adds a stray sentence around the object.
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

  const response = await anthropic.messages.parse({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(ExtractedExpenseSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("Claude did not return a parseable result for this file");
  }
  return response.parsed_output;
}
