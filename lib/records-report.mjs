const amount = value => Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0;
const money = value => 'INR ' + amount(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function recordsReport(records, filters, now = new Date()) {
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('From date must be on or before To date.');
  if (!records.length) throw new Error('No invoices match the current search, status, and date filters.');
  const query = (filters.query || '').trim().toLowerCase();
  const rows = records.map(record => {
    const total = Math.max(amount(record.total) - (Number(record.returnTotal) || 0), 0);
    const paid = Number(record.paid) || 0, due = Math.max(Number(record.due) || 0, 0);
    const advance = due <= 0 ? Math.max(paid - total, 0) : 0;
    const balance = due > 0.005 ? 'Due ' + money(due) : advance > 0.005 ? 'Advance +' + money(advance) : 'Settled';
    const exchanges = (Array.isArray(record.exchanges) ? record.exchanges : record.exchange ? [record.exchange] : []).map(entry => 'Exchange: ' + String(entry.metal || 'Gold') + ' ' + Number(entry.weight || 0).toFixed(3) + 'g x ' + money(entry.rate) + ' = ' + money(entry.value));
    const payments = (record.payments || []).map(entry => 'Payment: ' + String(entry.method || 'Amount') + ' ' + (entry.weight ? Number(entry.weight) + 'g x ' + money(entry.rate) + ' = ' : '') + money(entry.amount));
    const returns = (record.returns || []).map(entry => 'Return: ' + String(entry.noteNumber || '') + ' ' + String(entry.reason || '') + ' ' + money(entry.amount || entry.cashRefund || 0));
    return [record.number || '-', record.date || '-', (record.customer || 'Walk-in') + '\n' + (record.mobile || ''), record.items || '-', [...exchanges, ...payments, ...returns].join('\n') || '-', money(total), money(paid), balance,
      record.status === 'voided' ? 'Voided' : record.status === 'pending' ? 'Pending delivery' : due > 0.005 ? 'Due' : advance > 0.005 ? 'Advance' : 'Settled'];
  });
  return { rows, filename: query ? 'Invoices-' + query.replace(/[^a-z0-9-]+/gi, '-') + '.pdf' : 'Invoice-Records.pdf',
    description: rows.length + ' invoice' + (rows.length === 1 ? '' : 's') + (query ? ' | Search: ' + query : '') + ' | Status: ' + (filters.status || 'all') + (filters.from || filters.to ? ' | Invoice dates: ' + (filters.from || 'Beginning') + ' to ' + (filters.to || 'Present') : '') + ' | Generated: ' + now.toLocaleString('en-IN') };
}

export function downloadRecordsReport(records, filters, Pdf, now = new Date()) {
  const report = recordsReport(records, filters, now);
  if (!Pdf) throw new Error('PDF export is unavailable. Check your internet connection and try again.');
  const pdf = new Pdf({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight(), margin = 24, lineHeight = 8;
  const columns = [['Invoice', 62], ['Date', 48], ['Customer / Mobile', 100], ['Items', 145], ['Exchange & settlements', 145], ['Total', 66], ['Paid', 66], ['Balance', 98], ['Status', 55]];
  const scale = Math.min(1, (pageWidth - margin * 2) / columns.reduce((sum, column) => sum + column[1], 0));
  const widths = columns.map(column => column[1] * scale);
  let y = 64, hasBody = false;
  const header = () => {
    let x = margin;
    pdf.setFillColor(48, 39, 25); pdf.setTextColor(255, 246, 221); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7);
    columns.forEach((column, index) => { pdf.setFillColor(48, 39, 25); pdf.rect(x, y, widths[index], 22, 'F'); pdf.setTextColor(255, 246, 221); pdf.text(column[0], x + 3, y + 14, { maxWidth: widths[index] - 6 }); x += widths[index]; });
    y += 22;
  };
  const nextPage = () => { pdf.addPage(); y = margin; hasBody = false; header(); };
  const bodyStyle = () => { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(45, 40, 32); pdf.setDrawColor(210, 201, 182); pdf.setLineWidth(.35); };
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(60, 45, 20);
  pdf.text('Vishesh Jewellers - Invoice Records', margin, 28);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100, 90, 75);
  pdf.text(report.description, margin, 42, { maxWidth: pageWidth - margin * 2 }); header();
  for (const cells of report.rows) {
    bodyStyle();
    const wrapped = cells.map((value, index) => pdf.splitTextToSize(String(value), widths[index] - 6));
    const count = Math.max(1, ...wrapped.map(lines => lines.length));
    const fullHeight = Math.max(24, count * lineHeight + 8);
    if (y + fullHeight > pageHeight - margin && hasBody) nextPage();
    for (let offset = 0; offset < count;) {
      const capacity = Math.floor((pageHeight - margin - y - 8) / lineHeight);
      if (capacity < 2) { nextPage(); continue; }
      const length = Math.min(capacity, count - offset), height = Math.max(24, length * lineHeight + 8);
      bodyStyle(); let x = margin;
      wrapped.forEach((lines, index) => {
        pdf.rect(x, y, widths[index], height);
        const text = offset > 0 && index === 0 ? pdf.splitTextToSize(cells[0] + ' (cont.)', widths[0] - 6) : lines.slice(offset, offset + length);
        if (text.length) pdf.text(text, x + 3, y + 11, { maxWidth: widths[index] - 6 });
        x += widths[index];
      });
      offset += length; y += height; hasBody = true;
      if (offset < count) nextPage();
    }
  }
  pdf.save(report.filename);
  return report.rows.length;
}
