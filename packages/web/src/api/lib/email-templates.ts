const TEAL = "#2E5252";
const COPPER = "#AE633F";
const GOLD = "#C9B36A";
const CREAM = "#F2ECE4";

function wrapper(bodyHtml: string) {
  return `
  <div style="background:${CREAM};padding:32px 16px;font-family:'Jost',Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:6px;overflow:hidden;">
      <div style="background:${TEAL};padding:28px 24px;text-align:center;">
        <div style="color:${GOLD};font-family:Georgia,serif;letter-spacing:2px;font-size:20px;">STUDIO DAÏ OAKES</div>
        <div style="color:#F2ECE4cc;font-size:11px;letter-spacing:1px;margin-top:4px;">WOMEN'S RECOVERY &amp; CLINICAL PILATES</div>
      </div>
      <div style="padding:28px 24px;color:#1F2B28;font-size:14px;line-height:1.6;">
        ${bodyHtml}
      </div>
      <div style="background:${CREAM};padding:16px 24px;text-align:center;color:#6B6259;font-size:11px;">
        Bergstraat 46B, Rotterdam · daianeoakes.com
      </div>
    </div>
  </div>`;
}

export function buildInvoiceEmailHtml(opts: {
  clientName: string;
  invoiceNumber: string;
  total: number;
  dueDate: Date;
}) {
  return wrapper(`
    <p>Dear ${opts.clientName},</p>
    <p>Please find attached invoice <strong>${opts.invoiceNumber}</strong> for <strong>€${opts.total.toFixed(2)}</strong>, due on ${opts.dueDate.toLocaleDateString("en-GB")}.</p>
    <p>Thank you for choosing Studio Daï Oakes.</p>
    <p style="color:${COPPER};font-style:italic;">— Daiane</p>
  `);
}

export function buildReminderEmailHtml(opts: {
  clientName: string;
  invoiceNumber: string;
  total: number;
  dueDate: Date;
}) {
  return wrapper(`
    <p>Dear ${opts.clientName},</p>
    <p>This is a friendly reminder that invoice <strong>${opts.invoiceNumber}</strong> for <strong>€${opts.total.toFixed(2)}</strong> was due on ${opts.dueDate.toLocaleDateString("en-GB")} and remains unpaid.</p>
    <p>Please arrange payment at your earliest convenience.</p>
    <p style="color:${COPPER};font-style:italic;">— Studio Daï Oakes</p>
  `);
}

export function buildBookingConfirmationHtml(opts: {
  name: string;
  serviceName: string;
  date: string;
  startTime: string;
  payFullNow: boolean;
}) {
  return wrapper(`
    <p>Hi ${opts.name},</p>
    <p>Your booking for <strong>${opts.serviceName}</strong> on ${opts.date} at ${opts.startTime} is confirmed.</p>
    <p>${opts.payFullNow ? "Payment received in full." : "€25 deposit received — remainder due at the session."}</p>
    <p style="color:${COPPER};font-style:italic;">— Studio Daï Oakes</p>
  `);
}

export function buildAdminNewBookingHtml(opts: {
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  serviceName: string;
  date: string;
  startTime: string;
  amount: number;
  payFullNow: boolean;
}) {
  return wrapper(`
    <p><strong>New booking confirmed 🎉</strong></p>
    <p>
      <strong>${opts.clientName}</strong> (${opts.clientEmail}${opts.clientPhone ? `, ${opts.clientPhone}` : ""})<br/>
      ${opts.serviceName} — ${opts.date} at ${opts.startTime}<br/>
      ${opts.amount === 0 ? "Free session — no payment required." : `${opts.payFullNow ? "Paid in full" : "Deposit paid"}: €${opts.amount.toFixed(2)}`}
    </p>
  `);
}

export function buildAdminInvoicePaidHtml(opts: {
  clientName: string;
  invoiceNumber: string;
  total: number;
}) {
  return wrapper(`
    <p><strong>Invoice paid ✅</strong></p>
    <p>
      Invoice <strong>${opts.invoiceNumber}</strong> from <strong>${opts.clientName}</strong> was just paid — €${opts.total.toFixed(2)}.
    </p>
  `);
}
