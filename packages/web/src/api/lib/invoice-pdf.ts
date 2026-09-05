import PDFDocument from "pdfkit";
import { COMPANY, type CompanyInvoiceDetails } from "./company";
import { Cinzel_B64, Cormorant_B64, CormorantItalic_B64, Jost_B64, Logo_B64 } from "./brand-assets";

// Fonts and logo are embedded as base64 (see brand-assets.ts) instead of read from disk.
// This avoids any dependency on how the deployment environment packages/prunes files —
// works identically in dev and any published environment. We also never touch PDFKit's
// built-in standard fonts (Helvetica etc.) because those require .afm metric files that
// may be missing from a pruned node_modules in some deployment environments.
const FONT_BUFFERS = {
  Cinzel: Buffer.from(Cinzel_B64, "base64"),
  Cormorant: Buffer.from(Cormorant_B64, "base64"),
  "Cormorant-Italic": Buffer.from(CormorantItalic_B64, "base64"),
  Jost: Buffer.from(Jost_B64, "base64"),
};
const LOGO_BUFFER = Buffer.from(Logo_B64, "base64");

interface InvoiceItemLike {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  amount: number;
}

interface InvoicePdfData {
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  client: {
    name: string;
    address?: string | null;
    zipCode?: string | null;
    city?: string | null;
    country?: string | null;
    phone?: string | null;
  };
  items: InvoiceItemLike[];
  subtotal: number;
  vatTotal: number;
  total: number;
  notes?: string | null;
  vatBreakdown: { rate: number; base: number; vat: number }[];
  status?: string;
  paidAt?: Date | null;
  company?: CompanyInvoiceDetails;
  /** Overrides for reusing this layout for a non-invoice document (e.g. a quote). */
  documentLabel?: string; // default "INVOICE"
  dueDateLabel?: string; // default "Due date"
}

const TEAL = "#2E5252";
const TEAL_DARK = "#1F3B3B";
const COPPER = "#AE633F";
const GOLD = "#C9B36A";
const CREAM = "#F2ECE4";
const TEXT_DARK = "#1F2B28";
const TEXT_MUTED = "#6B6259";

export function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const company = data.company ?? COMPANY;
  return new Promise((resolve, reject) => {
    // Omitting `font` skips PDFKit's eager load of the "Helvetica" standard font
    // at construction time (it only loads one when the option is truthy) — we
    // register and use only our own embedded TTFs below.
    const doc = new PDFDocument({ margin: 0, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    for (const [name, buf] of Object.entries(FONT_BUFFERS)) {
      doc.registerFont(name, buf);
    }

    const F_DISPLAY = "Cinzel";
    const F_ACCENT = "Cormorant-Italic";
    const F_BODY = "Jost";

    const pageW = 595.28;

    // Header band
    doc.rect(0, 0, pageW, 130).fill(TEAL);
    doc.image(LOGO_BUFFER, 40, 22, { width: 150 });

    doc
      .fillColor(CREAM)
      .font(F_DISPLAY)
      .fontSize(22)
      .text(data.documentLabel ?? "INVOICE", 0, 40, { width: pageW - 40, align: "right" });
    doc
      .fillColor(GOLD)
      .font(F_BODY)
      .fontSize(9)
      .text(`No. ${data.invoiceNumber}`, 0, 70, { width: pageW - 40, align: "right" });
    if (data.status) {
      doc
        .fillColor(CREAM)
        .font(F_BODY)
        .fontSize(8)
        .text(data.status.toUpperCase(), 0, 84, { width: pageW - 40, align: "right" });
    }

    // Gold divider
    doc.rect(0, 130, pageW, 3).fill(GOLD);

    // Company / client info row
    let y = 155;
    doc.fillColor(TEXT_MUTED).font(F_BODY).fontSize(8).text("FROM", 40, y);
    doc
      .fillColor(TEXT_DARK)
      .font(F_BODY)
      .fontSize(10)
      .text(company.name, 40, y + 13, { width: 250 })
      .fillColor(TEXT_MUTED)
      .fontSize(8.5)
      .text(`${company.address}, ${company.zipCity}`, 40, y + 28, { width: 250 })
      .text(`KVK ${company.kvk}  ·  VAT ${company.vat}`, 40, y + 40, { width: 250 })
      .text(`IBAN ${company.iban}`, 40, y + 52, { width: 250 });

    doc.fillColor(TEXT_MUTED).font(F_BODY).fontSize(8).text("BILL TO", 320, y, { width: 235, align: "right" });
    doc
      .fillColor(TEXT_DARK)
      .font(F_BODY)
      .fontSize(10)
      .text(data.client.name, 320, y + 13, { width: 235, align: "right" })
      .fillColor(TEXT_MUTED)
      .fontSize(8.5)
      .text(
        [data.client.address, [data.client.zipCode, data.client.city].filter(Boolean).join(" "), data.client.country]
          .filter(Boolean)
          .join(", "),
        320,
        y + 28,
        { width: 235, align: "right" },
      );

    y += 78;
    doc.fillColor(TEXT_MUTED).font(F_BODY).fontSize(8.5);
    doc.text(`Issue date:  ${data.issueDate.toLocaleDateString("en-GB")}`, 40, y);
    doc.text(`${data.dueDateLabel ?? "Due date"}:  ${data.dueDate.toLocaleDateString("en-GB")}`, 200, y);
    if (data.paidAt) {
      doc.fillColor("#3F6B52").text(`Paid on ${data.paidAt.toLocaleDateString("en-GB")}`, 360, y, { width: 195, align: "right" });
    }

    y += 25;
    doc.moveTo(40, y).lineTo(pageW - 40, y).strokeColor("#DDD1BE").lineWidth(1).stroke();

    // Table header
    y += 15;
    doc.rect(40, y, pageW - 80, 24).fill(TEAL_DARK);
    doc
      .fillColor(CREAM)
      .font(F_BODY)
      .fontSize(8.5)
      .text("DESCRIPTION", 52, y + 8)
      .text("QTY", 300, y + 8, { width: 40, align: "right" })
      .text("UNIT PRICE", 345, y + 8, { width: 70, align: "right" })
      .text("VAT", 420, y + 8, { width: 40, align: "right" })
      .text("AMOUNT", 465, y + 8, { width: 90, align: "right" });

    y += 24;
    doc.font(F_BODY).fontSize(9.5);
    let rowIndex = 0;
    for (const item of data.items) {
      const rowH = 26;
      if (rowIndex % 2 === 1) {
        doc.rect(40, y, pageW - 80, rowH).fill(CREAM);
      }
      doc.fillColor(TEXT_DARK);
      doc.text(item.description, 52, y + 8, { width: 240 });
      doc.text(String(item.quantity), 300, y + 8, { width: 40, align: "right" });
      doc.text(`€${item.unitPrice.toFixed(2)}`, 345, y + 8, { width: 70, align: "right" });
      doc.fillColor(TEXT_MUTED).text(`${Math.round(item.vatRate * 100)}%`, 420, y + 8, { width: 40, align: "right" });
      doc.fillColor(TEXT_DARK).text(`€${item.amount.toFixed(2)}`, 465, y + 8, { width: 90, align: "right" });
      y += rowH;
      rowIndex++;
    }

    doc.moveTo(40, y).lineTo(pageW - 40, y).strokeColor("#DDD1BE").lineWidth(1).stroke();
    y += 18;

    // Totals block
    const totalsX = 340;
    doc.fillColor(TEXT_MUTED).fontSize(9).font(F_BODY);
    for (const b of data.vatBreakdown) {
      doc.text(`Subtotal excl. ${Math.round(b.rate * 100)}% VAT`, totalsX, y, { width: 115 });
      doc.text(`€${b.base.toFixed(2)}`, 465, y, { width: 90, align: "right" });
      y += 16;
      doc.text(`VAT ${Math.round(b.rate * 100)}%`, totalsX, y, { width: 115 });
      doc.text(`€${b.vat.toFixed(2)}`, 465, y, { width: 90, align: "right" });
      y += 16;
    }
    y += 6;
    doc.rect(totalsX - 12, y, pageW - 40 - (totalsX - 12), 32).fill(COPPER);
    doc
      .fillColor("#FFFFFF")
      .font(F_DISPLAY)
      .fontSize(12)
      .text("TOTAL", totalsX, y + 10, { width: 115 });
    doc.fontSize(13).text(`€${data.total.toFixed(2)}`, 465, y + 9, { width: 90, align: "right" });

    y += 55;
    if (data.notes) {
      doc.fillColor(TEXT_MUTED).font(F_BODY).fontSize(8.5).text(data.notes, 40, y, { width: pageW - 80 });
      y += 30;
    }

    // Footer
    doc.rect(0, 760, pageW, 82).fill(TEAL);
    doc
      .fillColor(GOLD)
      .font(F_ACCENT)
      .fontSize(13)
      .text("Women's Recovery & Clinical Pilates", 0, 778, { width: pageW, align: "center" });
    doc
      .fillColor(CREAM)
      .font(F_BODY)
      .fontSize(8)
      .text(
        `Payment term: ${company.paymentTermDays} days · IBAN ${company.iban} · ${company.phone}`,
        0,
        800,
        { width: pageW, align: "center" },
      )
      .text("daianeoakes.com", 0, 814, { width: pageW, align: "center" });

    doc.end();
  });
}
