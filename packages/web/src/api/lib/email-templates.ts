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
      <div style="background:${TEAL};padding:20px 24px;text-align:center;">
        <img src="${EMAIL_HEADER_LOGO_URL}" alt="Studio Daï Oakes" width="320" style="max-width:100%;height:auto;display:block;margin:0 auto;" />
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
    <p>Please plan to arrive <strong>15 minutes before</strong> your session time.</p>
    <div style="background:${CREAM};border-radius:6px;padding:14px 16px;margin:16px 0;font-size:12.5px;color:#6B6259;">
      <p style="margin:0 0 6px;font-weight:600;color:${TEAL};">Booking &amp; Cancellation Policy</p>
      <p style="margin:0 0 4px;">Reschedule or cancel free of charge up to 24 hours before your session.</p>
      <p style="margin:0 0 4px;">A deposit (or full payment) secures your slot — late cancellations may forfeit it.</p>
      <p style="margin:0;">Please arrive on time out of respect for every woman's schedule — yours and the next client's.</p>
    </div>
    <p style="color:${COPPER};font-style:italic;">— Studio Daï Oakes</p>
  `);
}

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

    <!-- EN -->
    <p style="margin-top:18px;"><strong style="color:${TEAL};">ENGLISH &nbsp;·&nbsp; Thank you for your session today.</strong><br/>
    I truly hope you're already feeling the difference. If you enjoyed our work together, it would mean the world to me if you shared it.</p>
    <p style="background:${CREAM};border-left:3px solid ${GOLD};padding:12px 14px;border-radius:4px;">
      <strong>Get ${promo} off your next session:</strong> post an Instagram story tagging
      <a href="${opts.instagramUrl}" style="color:${COPPER};">${opts.instagramHandle}</a>
      <em>and</em> leave a Google review. That's it — I'll apply your discount next time. 💛</p>

    <!-- PT -->
    <p style="margin-top:18px;"><strong style="color:${TEAL};">PORTUGUÊS &nbsp;·&nbsp; Obrigada pela sua sessão de hoje.</strong><br/>
    Espero que já esteja sentindo a diferença. Se gostou do nosso trabalho, ficaria muito feliz se você compartilhasse.</p>
    <p style="background:${CREAM};border-left:3px solid ${GOLD};padding:12px 14px;border-radius:4px;">
      <strong>Ganhe ${promo} de desconto na próxima sessão:</strong> faça um story no Instagram marcando
      <a href="${opts.instagramUrl}" style="color:${COPPER};">${opts.instagramHandle}</a>
      <em>e</em> deixe uma avaliação no Google. Só isso — aplico o desconto na sua próxima visita. 💛</p>

    <!-- NL -->
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
