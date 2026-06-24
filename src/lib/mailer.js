const { Resend } = require('resend');
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendOrderConfirmation({ to, buyer_first_name, event, order, tickets }) {
  console.log(`[mailer] → sendOrderConfirmation: to=${to}, order=${order.order_number}, event=${event && event.name}, tickets=${tickets.length}`);
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

  if (!resend) {
    console.log(`[mailer] Email skipped (no RESEND_API_KEY) — would send to: ${to}`);
    return;
  }

  console.log(`[mailer] ✉ Llamando a Resend.emails.send (from=${process.env.RESEND_FROM || 'tickets@silverglider.com'}, to=${to})...`);
  const result = await resend.emails.send({
    from: process.env.RESEND_FROM || 'tickets@silverglider.com',
    to,
    subject: `You're in — ${event.name}`,
    html
  });
  console.log(`[mailer] ✓ Resend respondió: id=${result && result.data && result.data.id}`, result && result.error ? `error=${JSON.stringify(result.error)}` : '');
  return result;
}

module.exports = { sendOrderConfirmation };
