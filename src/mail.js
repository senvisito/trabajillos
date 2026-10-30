// Envío de correos. Sin SMTP configurado, los correos se escriben en el log (útil para probar).
const nodemailer = require('nodemailer');

const SITE = process.env.SITE_URL || 'http://localhost:3000';
let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 587),
    secure: +(process.env.SMTP_PORT || 587) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

async function send(to, subject, text) {
  if (!to) return;
  const msg = { from: process.env.MAIL_FROM || 'Trabajillos <no-reply@civicloud.es>', to, subject,
    text: `${text}\n\n—\nTrabajillos · ${SITE}\nSi no quieres recibir estos avisos, responde a este correo.` };
  if (!transport) { console.log('[correo simulado]', to, '|', subject, '\n', text); return; }
  try { await transport.sendMail(msg); } catch (e) { console.error('[correo] error', e.message); }
}

module.exports = { send, SITE };
