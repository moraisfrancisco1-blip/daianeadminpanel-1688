import ExcelJS from "exceljs";

export interface InvoiceRow {
  invoiceNumber: string;
  clientName: string;
  issueDate: Date;
  dueDate: Date;
  subtotal: number;
  vatTotal: number;
  total: number;
  status: string;
  paidAt: Date | null;
  refundedAmount: number;
}

export interface RefundRow {
  invoiceNumber: string;
  clientName: string;
  amount: number;
  reason: string | null;
  status: string;
  createdAt: Date;
}

export async function generateMonthlyExcel(rows: InvoiceRow[], refundRows: RefundRow[], monthLabel: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(monthLabel);

  sheet.columns = [
    { header: "Invoice #", key: "invoiceNumber", width: 14 },
    { header: "Client", key: "clientName", width: 30 },
    { header: "Issue Date", key: "issueDate", width: 14 },
    { header: "Due Date", key: "dueDate", width: 14 },
    { header: "Subtotal (excl. VAT)", key: "subtotal", width: 18 },
    { header: "VAT", key: "vatTotal", width: 12 },
    { header: "Total (incl. VAT)", key: "total", width: 16 },
    { header: "Refunded", key: "refundedAmount", width: 14 },
    { header: "Net (Total - Refunded)", key: "netTotal", width: 18 },
    { header: "Status", key: "status", width: 12 },
    { header: "Paid At", key: "paidAt", width: 14 },
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB5652D" } };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  for (const r of rows) {
    sheet.addRow({
      invoiceNumber: r.invoiceNumber,
      clientName: r.clientName,
      issueDate: r.issueDate.toLocaleDateString("en-GB"),
      dueDate: r.dueDate.toLocaleDateString("en-GB"),
      subtotal: Number(r.subtotal.toFixed(2)),
      vatTotal: Number(r.vatTotal.toFixed(2)),
      total: Number(r.total.toFixed(2)),
      refundedAmount: Number(r.refundedAmount.toFixed(2)),
      netTotal: Number((r.total - r.refundedAmount).toFixed(2)),
      status: r.status,
      paidAt: r.paidAt ? r.paidAt.toLocaleDateString("en-GB") : "",
    });
  }

  const totalsRow = sheet.addRow({
    invoiceNumber: "",
    clientName: "TOTAL",
    issueDate: "",
    dueDate: "",
    subtotal: Number(rows.reduce((s, r) => s + r.subtotal, 0).toFixed(2)),
    vatTotal: Number(rows.reduce((s, r) => s + r.vatTotal, 0).toFixed(2)),
    total: Number(rows.reduce((s, r) => s + r.total, 0).toFixed(2)),
    refundedAmount: Number(rows.reduce((s, r) => s + r.refundedAmount, 0).toFixed(2)),
    netTotal: Number(rows.reduce((s, r) => s + (r.total - r.refundedAmount), 0).toFixed(2)),
    status: "",
    paidAt: "",
  });
  totalsRow.font = { bold: true };

  const refundSheet = wb.addWorksheet("Refunds");
  refundSheet.columns = [
    { header: "Invoice #", key: "invoiceNumber", width: 14 },
    { header: "Client", key: "clientName", width: 30 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Reason", key: "reason", width: 22 },
    { header: "Status", key: "status", width: 12 },
    { header: "Date", key: "createdAt", width: 14 },
  ];
  refundSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB5652D" } };
  refundSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  for (const r of refundRows) {
    refundSheet.addRow({
      invoiceNumber: r.invoiceNumber,
      clientName: r.clientName,
      amount: Number(r.amount.toFixed(2)),
      reason: r.reason ?? "",
      status: r.status,
      createdAt: r.createdAt.toLocaleDateString("en-GB"),
    });
  }
  if (refundRows.length === 0) {
    refundSheet.addRow({ invoiceNumber: "", clientName: "No refunds this month", amount: "", reason: "", status: "", createdAt: "" });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
