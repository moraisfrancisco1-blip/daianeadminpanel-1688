import { PRACTICE_ADDRESS } from "./company";

const TEAL = "#2E5252";
const COPPER = "#AE633F";
const GOLD = "#C9B36A";
const CREAM = "#F2ECE4";

const EMAIL_HEADER_LOGO_URL =
  "https://storage.googleapis.com/runable-templates/cli-uploads%2FX3TC6e19boi9erYmQpoYtDoP9hpMpUYH%2F8Gz9FVin3m02-JdU1H8W3%2Femail-header-logo.png";

function wrapper(bodyHtml: string) {
  return `
  <div style="background:${CREAM};padding:32px 16px;font-family:'Jost',Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:6px;overflow:hidden;">
      <div style="background:${TEAL};padding:0;text-align:center;">
        <img src="${EMAIL_HEADER_LOGO_URL}" alt="Studio Daï Oakes" style="width:100%;height:auto;display:block;" />
      </div>
      <div style="padding:28px 24px;color:#1F2B28;font-size:14px;line-height:1.6;">
        ${bodyHtml}
      </div>
      <div style="background:${CREAM};padding:16px 24px;text-align:center;color:#6B6259;font-size:11px;">
        ${PRACTICE_ADDRESS.full} · daianeoakes.com
      </div>
    </div>
  </div>`;
}

/**
 * Formats a date string (YYYY-MM-DD) into "weekday, day month year" format.
 * Example: "Thursday, 31 July 2026"
 */
function formatBookingDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const weekday = weekdays[date.getDay()];
  const monthName = months[date.getMonth()];
  return `${weekday}, ${day} ${monthName} ${year}`;
}

// ============================================================================
// 1. BOOKING CONFIRMATION (Free or Paid)
// ============================================================================
export function buildBookingConfirmationHtml(opts: {
  name: string;
  serviceName: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  depositAmount: number;
  depositStatus: string;
  paymentMethod: string | null;
  payFullNow: boolean;
  servicePrice: number;
  checkoutUrl?: string | null;
}) {
  const formattedDate = formatBookingDate(opts.date);
  const isFree = opts.servicePrice === 0;
  const isAlmostConfirmed = opts.depositStatus === "unpaid" && opts.checkoutUrl;

  const title = isAlmostConfirmed
    ? "✨ Your Appointment is Almost Confirmed"
    : "✨ Your Appointment is Confirmed";

  const subtitle = isAlmostConfirmed
    ? "Complete your payment to secure your slot."
    : "We're looking forward to welcoming you.";

  // Payment info
  let paymentInfo: string;
  if (isFree) {
    paymentInfo = `<span style="color:${TEAL};font-weight:600;">Free session — no payment required</span>`;
  } else if (opts.depositStatus === "paid") {
    paymentInfo = `<span style="color:${TEAL};font-weight:600;">✅ Paid — €${opts.servicePrice.toFixed(2)}</span>`;
  } else if (isAlmostConfirmed && opts.checkoutUrl) {
    paymentInfo = `
      <span style="color:${COPPER};font-weight:600;">⏳ Payment due — €${opts.servicePrice.toFixed(2)}</span><br/>
      <span style="font-size:12px;color:#6B6259;display:block;margin-top:8px;">To confirm your booking, please complete your payment here:</span>
      <a href="${opts.checkoutUrl}" style="display:inline-block;margin-top:8px;background:${TEAL};color:${GOLD};text-decoration:none;font-weight:600;letter-spacing:.5px;padding:12px 24px;border-radius:6px;font-size:14px;">Pay with card or iDEAL →</a>
    `;
  } else {
    paymentInfo = `<span style="color:${COPPER};font-weight:600;">⏳ To pay at session — €${opts.servicePrice.toFixed(2)}</span>`;
  }

  return wrapper(`
    <div style="text-align:center;margin-bottom:28px;">
      <p style="font-size:20px;color:${TEAL};margin:0 0 8px;">${title}</p>
      <p style="color:#6B6259;margin:0;">${subtitle}</p>
    </div>

    <div style="background:${CREAM};border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <p style="font-size:13px;font-weight:600;color:${TEAL};margin:0 0 14px;letter-spacing:1px;text-transform:uppercase;">📅 Appointment Details</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6B6259;width:100px;vertical-align:top;">👤 Patient</td><td style="padding:6px 0;font-weight:500;">${opts.name}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6259;vertical-align:top;">🩺 Service</td><td style="padding:6px 0;font-weight:500;">${opts.serviceName}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6259;vertical-align:top;">📆 Date</td><td style="padding:6px 0;font-weight:500;">${formattedDate}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6259;vertical-align:top;">⏰ Time</td><td style="padding:6px 0;font-weight:500;">${opts.startTime}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6259;vertical-align:top;">⏱ Duration</td><td style="padding:6px 0;font-weight:500;">${opts.durationMinutes} minutes</td></tr>
        <tr><td style="padding:6px 0;color:#6B6259;vertical-align:top;">💳 Payment</td><td style="padding:6px 0;">${paymentInfo}</td></tr>
      </table>
    </div>

    <div style="margin-bottom:24px;">
      <p style="font-size:13px;font-weight:600;color:${TEAL};margin:0 0 10px;">📍 Before Your Visit</p>
      <p style="margin:0 0 4px;">👟 Please arrive wearing comfortable sportswear.</p>
    </div>

    <div style="border-top:1px solid ${GOLD};margin:0 0 20px;"></div>

    <div style="margin-bottom:20px;">
      <p style="font-size:13px;font-weight:600;color:${TEAL};margin:0 0 10px;">Booking Policy</p>
      <p style="margin:0 0 6px;font-weight:600;">⏰ 24-Hour Notice</p>
      <p style="margin:0 0 14px;color:#6B6259;">Reschedule or cancel free of charge up to 24 hours before your session.</p>
      <p style="margin:0 0 6px;font-weight:600;">💳 Payment Secures Your Slot</p>
      <p style="margin:0 0 14px;color:#6B6259;">Full payment confirms your booking.<br/>Late cancellations or missed appointments may result in the payment being forfeited.</p>
      <p style="margin:0 0 6px;font-weight:600;">🕙 Please Arrive on Time</p>
      <p style="margin:0;color:#6B6259;">Sessions begin and end on schedule out of respect for every woman's time — yours and the next client's.</p>
    </div>

    <div style="border-top:1px solid ${GOLD};margin:0 0 20px;"></div>

    <p style="text-align:center;color:${COPPER};font-style:italic;font-size:15px;margin:0;">Obrigada e Namaste 🙏🏼</p>
  `);
}

// ============================================================================
// 2. REMAINDER PAYMENT (10 min before session ends)
// ============================================================================
export function buildRemainderPaymentEmailHtml(opts: {
  name: string;
  serviceName: string;
  date: string;
  startTime: string;
  depositAmount: number;
  servicePrice: number;
  checkoutUrl: string;
}) {
  const formattedDate = formatBookingDate(opts.date);
  const remainder = opts.servicePrice - opts.depositAmount;

  return wrapper(`
    <div style="text-align:center;margin-bottom:28px;">
      <p style="font-size:20px;color:${TEAL};margin:0 0 8px;">💳 Payment Reminder</p>
      <p style="color:#6B6259;margin:0;">Your session is about to end. Please complete your payment.</p>
    </div>

    <div style="background:${CREAM};border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <p style="font-size:13px;font-weight:600;color:${TEAL};margin:0 0 14px;letter-spacing:1px;text-transform:uppercase;">📅 Session Details</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6B6259;width:100px;vertical-align:top;">👤 Patient</td><td style="padding:6px 0;font-weight:500;">${opts.name}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6259;vertical-align:top;">🩺 Service</td><td style="padding:6px 0;font-weight:500;">${opts.serviceName}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6259;vertical-align:top;">📆 Date</td><td style="padding:6px 0;font-weight:500;">${formattedDate}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6259;vertical-align:top;">⏰ Time</td><td style="padding:6px 0;font-weight:500;">${opts.startTime}</td></tr>
      </table>
    </div>

    <div style="background:#ffffff;border:2px solid ${GOLD};border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <p style="font-size:13px;font-weight:600;color:${TEAL};margin:0 0 14px;letter-spacing:1px;text-transform:uppercase;">💶 Payment Summary</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6B6259;">Session total</td><td style="padding:6px 0;font-weight:500;text-align:right;">€${opts.servicePrice.toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#6B6259;">Deposit paid</td><td style="padding:6px 0;font-weight:500;text-align:right;color:${TEAL};">- €${opts.depositAmount.toFixed(2)}</td></tr>
        <tr><td colspan="2" style="padding:8px 0 0;border-top:1px solid ${GOLD};"></td></tr>
        <tr><td style="padding:8px 0;color:${COPPER};font-weight:600;font-size:16px;">Amount due</td><td style="padding:8px 0;font-weight:700;text-align:right;color:${COPPER};font-size:18px;">€${remainder.toFixed(2)}</td></tr>
      </table>
    </div>

    <div style="text-align:center;margin-bottom:24px;">
      <p style="color:#6B6259;margin:0 0 12px;font-size:13px;">Please pay the remaining amount now:</p>
      <a href="${opts.checkoutUrl}" style="display:inline-block;background:${TEAL};color:${GOLD};text-decoration:none;font-weight:600;letter-spacing:.5px;padding:14px 32px;border-radius:6px;font-size:15px;">Pay €${remainder.toFixed(2)} with iDEAL →</a>
    </div>

    <div style="border-top:1px solid ${GOLD};margin:0 0 20px;"></div>

    <p style="text-align:center;color:${COPPER};font-style:italic;font-size:15px;margin:0;">Obrigada e Namaste 🙏🏼</p>
  `);
}

// ============================================================================
// 3. SESSION REMINDER (2 days or 1 day before)
// ============================================================================
export function buildSessionReminderEmailHtml(opts: {
  clientName: string;
  serviceName: string;
  date: string;
  startTime: string;
  daysAway: 1 | 2;
}) {
  const when = opts.daysAway === 2 ? "in 2 days" : "tomorrow";
  return wrapper(`
    <p>Hi ${opts.clientName},</p>
    <p>Just a friendly reminder that your <strong>${opts.serviceName}</strong> session is coming up ${when} —
    on <strong>${opts.date} at ${opts.startTime}</strong>.</p>
    <p>Please plan to arrive <strong>15 minutes before</strong> your session time.</p>
    <p>Need to reschedule? Just reply to this email or reach out at least 24 hours in advance.</p>
    <p style="color:${COPPER};font-style:italic;">— Studio Daï Oakes</p>
  `);
}

// ============================================================================
// 4. POST-SESSION REVIEW & PROMO (Trilingual)
// ============================================================================
export function buildPostSessionEmailHtml(opts: {
  name: string;
  reviewUrl: string;
  instagramHandle: string;
  instagramUrl: string;
  promoAmount: number;
}) {
  const firstName = opts.name.split(" ")[0] || opts.name;
  const promo = `€${opts.promoAmount}`;
  const button = (href: string, label: string) => `
    <a href="${href}" style="display:inline-block;background:${TEAL};color:${GOLD};text-decoration:none;
      font-weight:600;letter-spacing:.5px;padding:14px 28px;border-radius:6px;font-size:15px;">${label}</a>`;

  return wrapper(`
    <p>Hi ${firstName}, / Oi ${firstName}, / Hoi ${firstName},</p>

    <p style="margin-top:18px;"><strong style="color:${TEAL};">ENGLISH &nbsp;·&nbsp; Thank you for your session today.</strong><br/>
    I truly hope you're already feeling the difference. If you enjoyed our work together, it would mean the world to me if you shared it.</p>
    <p style="background:${CREAM};border-left:3px solid ${GOLD};padding:12px 14px;border-radius:4px;">
      <strong>Get ${promo} off your next session:</strong> post an Instagram story tagging
      <a href="${opts.instagramUrl}" style="color:${COPPER};">${opts.instagramHandle}</a>
      <em>and</em> leave a Google review. That's it — I'll apply your discount next time. 💛</p>

    <p style="margin-top:18px;"><strong style="color:${TEAL};">PORTUGUÊS &nbsp;·&nbsp; Obrigada pela sua sessão de hoje.</strong><br/>
    Espero que já esteja sentindo a diferença. Se gostou do nosso trabalho, ficaria muito feliz se você compartilhasse.</p>
    <p style="background:${CREAM};border-left:3px solid ${GOLD};padding:12px 14px;border-radius:4px;">
      <strong>Ganhe ${promo} de desconto na próxima sessão:</strong> faça um story no Instagram marcando
      <a href="${opts.instagramUrl}" style="color:${COPPER};">${opts.instagramHandle}</a>
      <em>e</em> deixe uma avaliação no Google. Só isso — aplico o desconto na sua próxima visita. 💛</p>

    <p style="margin-top:18px;"><strong style="color:${TEAL};">NEDERLANDS &nbsp;·&nbsp; Bedankt voor je sessie vandaag.</strong><br/>
    Ik hoop dat je het verschil al voelt. Als je tevreden bent, zou ik het geweldig vinden als je dat deelt.</p>
    <p style="background:${CREAM};border-left:3px solid ${GOLD};padding:12px 14px;border-radius:4px;">
      <strong>Krijg ${promo} korting op je volgende sessie:</strong> plaats een Instagram-story met
      <a href="${opts.instagramUrl}" style="color:${COPPER};">${opts.instagramHandle}</a>
      <em>én</em> laat een Google-review achter. Dat is alles — ik verreken de korting bij je volgende bezoek. 💛</p>

    <div style="text-align:center;margin:26px 0 10px;">
      ${button(opts.reviewUrl, "★  Leave a Google review")}
    </div>
    <p style="text-align:center;font-size:12px;color:#6B6259;">
      <a href="${opts.instagramUrl}" style="color:${COPPER};">Open Instagram → ${opts.instagramHandle}</a>
    </p>

    <p style="color:${COPPER};font-style:italic;margin-top:22px;">— Daï</p>
  `);
}

// ============================================================================
// 5. INVOICE EMAIL
// ============================================================================
export function buildInvoiceEmailHtml(opts: {
  clientName: string;
  invoiceNumber: string;
  total: number;
  dueDate: Date;
  paymentUrl?: string | null;
}) {
  return wrapper(`
    <p>Dear ${opts.clientName},</p>
    <p>Please find attached invoice <strong>${opts.invoiceNumber}</strong> for <strong>€${opts.total.toFixed(2)}</strong>, due on ${opts.dueDate.toLocaleDateString("en-GB")}.</p>
    ${opts.paymentUrl ? `<p><a href="${opts.paymentUrl}" style="display:inline-block;background:${COPPER};color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;">Pay now</a></p>` : ""}
    <p>Thank you for choosing Studio Daï Oakes.</p>
    <p style="color:${COPPER};font-style:italic;">— Daiane</p>
  `);
}

// ============================================================================
// 6. PAYMENT LINK EMAIL  (separate from the invoice PDF email — sends only the link)
// ============================================================================
export function buildPaymentLinkEmailHtml(opts: {
  clientName: string;
  invoiceNumber: string;
  total: number;
  paymentUrl: string;
}) {
  return wrapper(`
    <p>Dear ${opts.clientName},</p>
    <p>You have an open invoice <strong>${opts.invoiceNumber}</strong> for <strong>€${opts.total.toFixed(2)}</strong>.</p>
    <p style="text-align:center;">
      <a href="${opts.paymentUrl}" style="display:inline-block;background:${COPPER};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold;">
        Pay invoice now
      </a>
    </p>
    <p>If the button doesn't work, copy and paste this link into your browser:<br/>
      <a href="${opts.paymentUrl}" style="color:${COPPER};">${opts.paymentUrl}</a>
    </p>
    <p>Thank you for choosing Studio Daï Oakes.</p>
    <p style="color:${COPPER};font-style:italic;">— Studio Daï Oakes</p>
  `);
}

// ============================================================================
// 7. INVOICE REMINDER
// ============================================================================
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

// ============================================================================
// ADMIN EMAILS
// ============================================================================
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

export function buildRebookReminderEmailHtml(opts: { name: string }) {
  return wrapper(`
    <h2 style="color:${TEAL};font-size:20px;margin:0 0 12px;">Olá ${opts.name} 👋</h2>
    <p style="margin:0 0 12px;">Já passou algum tempo desde a sua última sessão. Como se tem sentido?</p>
    <p style="margin:0 0 16px;">Se quiser, podemos marcar a sua próxima sessão. Responda a este email ou visite o site para escolher o melhor horário.</p>
    <a href="https://daianeoakes.com" style="display:inline-block;background:${COPPER};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:500;">Marcar sessão</a>
  `);
}