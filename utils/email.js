import nodemailer from "nodemailer";

function smtpUser() {
  return (
    process.env.SMTP_USER?.trim() ||
    process.env.SMTP_MAIL?.trim() ||
    ""
  );
}

function smtpPass() {
  return (
    process.env.SMTP_PASS?.trim() ||
    process.env.SMTP_PASSWORD?.trim() ||
    ""
  );
}

function resolveSmtpHost() {
  const fromEnv = process.env.SMTP_HOST?.trim();
  if (fromEnv) return fromEnv;
  const service = process.env.SMTP_SERVICE?.trim().toLowerCase();
  if (service === "gmail") return "smtp.gmail.com";
  return "smtp.gmail.com";
}

function resolvePort() {
  const raw = process.env.SMTP_PORT?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return 587;
}

/** Port 465 uses implicit TLS; 587 uses STARTTLS (secure: false). */
function resolveSecure(port) {
  const explicit = process.env.SMTP_SECURE?.trim().toLowerCase();
  if (explicit === "true" || explicit === "1" || explicit === "yes")
    return true;
  if (explicit === "false" || explicit === "0" || explicit === "no")
    return false;
  return port === 465;
}

function getTransport() {
  const user = smtpUser();
  const pass = smtpPass();
  if (!user || !pass) return null;

  const host = resolveSmtpHost();
  const port = resolvePort();
  const secure = resolveSecure(port);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" },
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  });
}

/**
 * Send password reset link via SMTP (Gmail or any host in .env).
 */
export async function sendPasswordResetEmail(to, resetUrl) {
  const transport = getTransport();
  if (!transport) {
    const err = new Error(
      "Email is not configured. Set SMTP_USER (or SMTP_MAIL) and SMTP_PASS (or SMTP_PASSWORD) in server .env. For Gmail use an App Password."
    );
    err.statusCode = 503;
    throw err;
  }

  const from =
    process.env.MAIL_FROM?.trim() || `Chatr <${smtpUser()}>`;

  try {
    await transport.verify();
  } catch (e) {
    console.error("[smtp] verify failed:", e?.message || e);
    const err = new Error(
      `SMTP connection failed: ${e?.message || "check host, port, and app password"}`
    );
    err.statusCode = 503;
    err.cause = e;
    throw err;
  }

  try {
    await transport.sendMail({
    from,
    to,
    subject: "Reset your Chatr password",
    text: `You requested a password reset.\n\nOpen this link (valid 1 hour):\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    html: `
      <p>You requested a password reset for your Chatr account.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px;">Reset password</a></p>
      <p style="color:#64748b;font-size:12px;">This link expires in 1 hour. If you did not request a reset, you can ignore this email.</p>
      <p style="color:#64748b;font-size:11px;">If the button does not work, paste this URL into your browser:<br/>${resetUrl}</p>
    `,
    });
  } catch (e) {
    console.error("[smtp] sendMail failed:", e?.message || e, e?.response);
    throw e;
  }
}
