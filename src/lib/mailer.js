const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendOrderConfirmation({ to, buyer_first_name, event, order, tickets }) {
  const walletUrl = `${process.env.APP_URL}/wallet?order=${order.order_number}&token=${order.secure_token}`;

  const ticketRows = tickets.map(t => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #222;font-family:monospace;color:#f0f0f0">${t.ticket_id}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #222;color:#888">${t.ticket_type}</td>
    </tr>
  `).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="background:#0a0a0a;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;padding:40px 20px">
    <tr><td>
      <p style="font-size:13px;letter-spacing:.15em;color:#666;margin-bottom:32px">⬡ SILVER GLIDER</p>
      <h1 style="font-size:28px;font-weight:700;margin-bottom:8px;color:#f0f0f0">You're in.</h1>
      <p style="color:#666;font-size:15px;margin-bottom:32px">${event.name}</p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;border-radius:12px;padding:24px;margin-bottom:24px">
        <tr><td style="padding:8px 0;border-bottom:1px solid #1a1a1a">
          <span style="color:#555;font-size:13px">Event</span>
          <span style="float:right;font-size:13px;color:#f0f0f0">${event.name}</span>
        </td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #1a1a1a">
          <span style="color:#555;font-size:13px">Date</span>
          <span style="float:right;font-size:13px;color:#f0f0f0">${new Date(event.event_date).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</span>
        </td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #1a1a1a">
          <span style="color:#555;font-size:13px">Venue</span>
          <span style="float:right;font-size:13px;color:#f0f0f0">${event.venue}</span>
        </td></tr>
        <tr><td style="padding:8px 0">
          <span style="color:#555;font-size:13px">Confirmation</span>
          <span style="float:right;font-family:monospace;font-size:14px;font-weight:700;color:#f0f0f0">${order.order_number}</span>
        </td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;border-radius:12px;margin-bottom:24px">
        <tr>
          <th style="text-align:left;padding:10px 12px;font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #1a1a1a">Ticket ID</th>
          <th style="text-align:left;padding:10px 12px;font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #1a1a1a">Type</th>
        </tr>
        ${ticketRows}
      </table>

      <a href="${walletUrl}" style="display:block;background:#f0f0f0;color:#0a0a0a;text-align:center;padding:16px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin-bottom:32px">View My Tickets</a>

      <p style="color:#444;font-size:12px;text-align:center">Silver Glider · ${event.venue}</p>
    </td></tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: process.env.RESEND_FROM || 'tickets@silverglider.com',
    to,
    subject: `You're in — ${event.name}`,
    html
  });
}

async function sendBoothConfirmation({ to, boothName, activationName, profileUrl }) {
  if (!resend) return;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="background:#0a0a0a;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;padding:40px 20px">
    <tr><td>
      <p style="font-size:12px;letter-spacing:.15em;color:#555;margin-bottom:32px;text-transform:uppercase">⬡ Silver Glider Activations</p>
      <h1 style="font-size:26px;font-weight:700;margin-bottom:8px;color:#f0f0f0">You're in the running.</h1>
      <p style="color:#666;font-size:15px;margin-bottom:32px">${activationName} — Best Booth Award</p>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #1a1a1a;border-radius:12px;padding:20px;margin-bottom:28px">
        <tr><td style="padding:8px 0;border-bottom:1px solid #1a1a1a">
          <span style="color:#555;font-size:13px">Booth</span>
          <span style="float:right;font-size:13px;color:#f0f0f0;font-weight:600">${boothName}</span>
        </td></tr>
        <tr><td style="padding:8px 0">
          <span style="color:#555;font-size:13px">Status</span>
          <span style="float:right;font-size:13px;color:#1CC5BE;font-weight:600">Approved — live now</span>
        </td></tr>
      </table>

      <p style="color:#666;font-size:14px;margin-bottom:20px;line-height:1.6">Your booth QR code is ready. Print it and display it at your booth so festival attendees can scan and vote for you.</p>

      <a href="${profileUrl}" style="display:block;background:#1CC5BE;color:#0a0a0a;text-align:center;padding:16px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;margin-bottom:32px">Print My QR Code</a>

      <p style="color:#333;font-size:12px;text-align:center;line-height:1.6">Top booth wins 2 concert tickets.<br>Silver Glider — music discovery by text.</p>
    </td></tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: process.env.RESEND_FROM || 'booths@silverglidertix.com',
    to,
    subject: `Your booth is live — ${activationName}`,
    html
  });
}

async function sendWelcomeEmail({ to }) {
  if (!resend) return;
  const baseUrl = process.env.RAILWAY_BASE_URL || 'https://silver-glider-tickets-production-e4a0.up.railway.app';
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="background:#0a0a0a;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;padding:48px 24px">
    <tr><td style="text-align:center;padding-bottom:40px">
      <img src="${baseUrl}/logo.png" alt="Silver Glider" width="100" height="100" style="display:inline-block">
    </td></tr>
    <tr><td style="border-top:1px solid #1a1a1a;padding-top:40px">

      <h1 style="font-size:32px;font-weight:800;margin:0 0 20px;color:#f0f0f0;letter-spacing:-.02em;line-height:1.1">Good taste confirmed.</h1>

      <p style="font-size:16px;color:#888;line-height:1.7;margin:0 0 6px">Every Friday we'll send you 3 SF shows worth going to.</p>
      <p style="font-size:15px;color:#555;line-height:1.7;margin:0 0 40px;font-style:italic">We do the digging, you show up.</p>

      <div style="background:#111;border:1px solid #1a1a1a;border-radius:12px;padding:20px 24px;margin-bottom:48px">
        <p style="font-size:11px;color:#444;margin:0 0 6px;text-transform:uppercase;letter-spacing:.1em">First drop</p>
        <p style="font-size:16px;color:#1CC5BE;margin:0;font-weight:700">3 shows — this Friday</p>
      </div>

      <div style="border-top:1px solid #1a1a1a;padding-top:32px;text-align:center">
        <p style="font-size:12px;color:#555;line-height:1.8;margin:0 0 12px">You're receiving this because you signed up at a Silver Glider activation.<br>We'll never share your email or send you anything other than concert picks.</p>
        <p style="font-size:12px;margin:0 0 12px">
          <a href="${baseUrl}/unsubscribe?email=${encodeURIComponent(to)}" style="color:#555;text-decoration:underline">Unsubscribe</a>
          <span style="color:#333;margin:0 8px">·</span>
          <a href="https://silverglidertickets.com" style="color:#555;text-decoration:none">silverglidertickets.com</a>
        </p>
        <p style="font-size:11px;color:#444;margin:0">Silver Glider · 490 Post St, Suite 500, San Francisco, CA 94102</p>
      </div>

    </td></tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: process.env.RESEND_FROM || 'activations@silverglidertix.com',
    to,
    subject: `Good taste confirmed.`,
    html
  });
}

module.exports = { sendOrderConfirmation, sendBoothConfirmation, sendWelcomeEmail };
