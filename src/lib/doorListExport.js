// Exportación de la lista de puerta a CSV y PDF. Columnas fijas: nombre del comprador,
// nº de confirmación, cantidad, tipo y estado de check-in. Email y teléfono, opcionales.
const PDFDocument = require('pdfkit');

function buildColumns({ includeEmail, includePhone }) {
  const cols = [
    { key: 'buyer_last_name', label: 'Last Name', weight: 1.3 },
    { key: 'buyer_first_name', label: 'First Name', weight: 1.3 },
  ];
  if (includeEmail) cols.push({ key: 'buyer_email', label: 'Email', weight: 2.2 });
  if (includePhone) cols.push({ key: 'buyer_phone', label: 'Phone', weight: 1.3 });
  cols.push(
    { key: 'order_number', label: 'Confirmation #', weight: 1.1 },
    { key: 'tickets_total', label: 'Qty', weight: 0.45, align: 'right' },
    { key: 'ticket_type', label: 'Type', weight: 1.3 },
    { key: 'checkin', label: 'Checked In', weight: 0.9 },
  );
  return cols;
}

function cellValue(row, key) {
  if (key === 'checkin') return `${row.tickets_checked_in}/${row.tickets_total}`;
  const v = row[key];
  return v === null || v === undefined ? '' : String(v);
}

// Una celda que empieza por = + - @ (o tab/CR) se ejecuta como fórmula en Excel/Sheets.
// Los datos del comprador vienen del checkout, así que se neutralizan con un apóstrofo.
function csvCell(value) {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function buildDoorListCsv(rows, options) {
  const cols = buildColumns(options);
  const lines = [cols.map((c) => csvCell(c.label)).join(',')];
  for (const row of rows) lines.push(cols.map((c) => csvCell(cellValue(row, c.key))).join(','));
  // BOM: sin él Excel abre el UTF-8 como ANSI y rompe acentos y eñes.
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

function buildDoorListPdf(rows, event, options) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 36, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const cols = buildColumns(options);
    const left = doc.page.margins.left;
    const tableWidth = doc.page.width - left - doc.page.margins.right;
    const boxCol = 22; // casilla para marcar a mano en puerta
    const totalWeight = cols.reduce((s, c) => s + c.weight, 0);
    const widths = cols.map((c) => ((tableWidth - boxCol) * c.weight) / totalWeight);
    const rowH = 18;
    const pad = 4;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 16;

    const totalTickets = rows.reduce((s, r) => s + r.tickets_total, 0);
    const checkedIn = rows.reduce((s, r) => s + r.tickets_checked_in, 0);
    const eventDate = event.event_date ? new Date(event.event_date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';

    function drawHeaderRow(y) {
      doc.rect(left, y, tableWidth, rowH).fill('#111111');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
      let x = left + boxCol;
      cols.forEach((c, i) => {
        doc.text(c.label.toUpperCase(), x + pad, y + 5, { width: widths[i] - pad * 2, height: rowH, ellipsis: true, align: c.align || 'left' });
        x += widths[i];
      });
      doc.fillColor('#000000');
      return y + rowH;
    }

    doc.font('Helvetica-Bold').fontSize(16).text(event.name || 'Door List', left, 36);
    doc.font('Helvetica').fontSize(9).fillColor('#444444')
      .text([eventDate, event.venue].filter(Boolean).join('  ·  '))
      .text(`${rows.length} orders  ·  ${totalTickets} tickets  ·  ${checkedIn} checked in  ·  generated ${new Date().toLocaleString('en-US')}`);
    doc.fillColor('#000000');

    let y = drawHeaderRow(doc.y + 10);
    rows.forEach((row, idx) => {
      if (y + rowH > bottom()) {
        doc.addPage();
        y = drawHeaderRow(doc.page.margins.top);
      }
      if (idx % 2 === 1) doc.rect(left, y, tableWidth, rowH).fill('#f2f2f2').fillColor('#000000');
      doc.lineWidth(0.7).rect(left + 6, y + 4, 10, 10).stroke('#555555');
      if (row.tickets_total > 0 && row.tickets_checked_in === row.tickets_total) {
        doc.moveTo(left + 8, y + 9).lineTo(left + 10.5, y + 12).lineTo(left + 14.5, y + 6).stroke('#000000');
      }
      doc.font('Helvetica').fontSize(9);
      let x = left + boxCol;
      cols.forEach((c, i) => {
        const bold = c.key === 'buyer_last_name';
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .text(cellValue(row, c.key), x + pad, y + 5, { width: widths[i] - pad * 2, height: rowH - 4, ellipsis: true, align: c.align || 'left' });
        x += widths[i];
      });
      y += rowH;
    });

    if (!rows.length) doc.font('Helvetica').fontSize(10).text('No orders for this event yet.', left, y + 12);

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // El pie va en la zona del margen inferior: sin anular el margen, pdfkit abriría
      // una página nueva al escribir ahí.
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor('#777777')
        .text(`Silver Glider — ${event.name || ''}  ·  Page ${i + 1} of ${range.count}`,
          left, doc.page.height - bottomMargin - 8, { width: tableWidth, align: 'center', lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
  });
}

module.exports = { buildDoorListCsv, buildDoorListPdf };
