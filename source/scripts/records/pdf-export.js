const exportRecordPdf = async filters => {
    const query = (filters.query || '').trim().toLowerCase();
    const statusFilter = filters.status || 'all';
    const from = filters.from || '';
    const to = filters.to || '';
    if (from && to && from > to) { showAppMessage('From date must be on or before To date.', 'error'); return; }
    const allRecords = await getRecords();
    const rows = allRecords.filter(record => recordMatchesFilters(record, query, statusFilter, from, to));
    if (!rows.length) { showAppMessage('No invoices match the current search, status, and date filters.', 'error'); return; }
    if (!window.jspdf || !window.jspdf.jsPDF) { showAppMessage('PDF export is unavailable. Check your internet connection and try again.', 'error'); return; }
    try {
      const pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pdfMoney = value => money(value).replace('₹', 'INR ');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 24;
      const columns = [
        { title: 'Invoice', width: 62 }, { title: 'Date', width: 48 }, { title: 'Customer / Mobile', width: 100 },
        { title: 'Items', width: 145 }, { title: 'Exchange & settlements', width: 145 },
        { title: 'Total', width: 66 }, { title: 'Paid', width: 66 }, { title: 'Balance', width: 98 }, { title: 'Status', width: 55 }
      ];
      const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
      const scale = Math.min(1, (pageWidth - margin * 2) / tableWidth);
      columns.forEach(column => { column.width *= scale; });
      const lineHeight = 8;
      let y = 64;
      const drawHeader = () => {
        let x = margin;
        pdf.setFillColor(48, 39, 25); pdf.setTextColor(255, 246, 221); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7);
        columns.forEach(column => { pdf.rect(x, y, column.width, 22, 'F'); pdf.text(column.title, x + 3, y + 14, { maxWidth: column.width - 6 }); x += column.width; });
        y += 22;
      };
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(60, 45, 20);
      pdf.text('Vishesh Jewellers - Invoice Records', margin, 28);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100, 90, 75);
      pdf.text(rows.length + ' invoice' + (rows.length === 1 ? '' : 's') + (query ? ' | Search: ' + query : '') + ' | Status: ' + statusFilter + (from || to ? ' | Invoice dates: ' + (from || 'Beginning') + ' to ' + (to || 'Present') : '') + ' | Generated: ' + new Date().toLocaleString('en-IN'), margin, 42, { maxWidth: pageWidth - margin * 2 });
      drawHeader();
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(45, 40, 32);
      for (const record of rows) {
        const netTotal = recordNetTotal(record);
        const paid = Number(record.paid) || 0;
        const due = Math.max(Number(record.due) || 0, 0);
        const advance = due <= 0 ? Math.max(paid - netTotal, 0) : 0;
        const balance = due > 0.005 ? 'Due ' + pdfMoney(due) : advance > 0.005 ? 'Advance +' + pdfMoney(advance) : 'Settled';
        const exchanges = (Array.isArray(record.exchanges) ? record.exchanges : record.exchange ? [record.exchange] : []).map(exchange => String(exchange.metal || 'Gold') + ' ' + Number(exchange.weight || 0).toFixed(3) + 'g x ' + pdfMoney(exchange.rate) + ' = ' + pdfMoney(exchange.value));
        const settlements = (record.payments || []).map(payment => String(payment.method || 'Amount') + ' ' + (payment.weight ? Number(payment.weight) + 'g x ' + pdfMoney(payment.rate) + ' = ' : '') + pdfMoney(payment.amount));
        const returns = (record.returns || []).map(entry => 'Return: ' + String(entry.noteNumber || '') + ' ' + String(entry.reason || '') + ' ' + pdfMoney(entry.amount || entry.cashRefund || 0));
        const customer = (record.customer || 'Walk-in') + '\n' + (record.mobile || '');
        const adjustmentDetails = [...exchanges.map(value => 'Exchange: ' + value), ...settlements.map(value => 'Payment: ' + value), ...returns].join('\n') || '-';
        const contents = [record.number || '-', record.date || '-', customer, record.items || '-', adjustmentDetails, pdfMoney(netTotal), pdfMoney(paid), balance, record.status === 'voided' ? 'Voided' : record.status === 'pending' ? 'Pending delivery' : due > 0.005 ? 'Due' : advance > 0.005 ? 'Advance' : 'Settled'];
        const wrapped = contents.map((value, index) => pdf.splitTextToSize(String(value), columns[index].width - 6));
        const rowHeight = Math.max(24, ...wrapped.map(lines => lines.length * lineHeight + 8));
        if (y + rowHeight > pdf.internal.pageSize.getHeight() - margin) { pdf.addPage(); y = margin; drawHeader(); }
        let x = margin;
        pdf.setDrawColor(210, 201, 182); pdf.setLineWidth(.35);
        wrapped.forEach((lines, index) => {
          pdf.rect(x, y, columns[index].width, rowHeight);
          pdf.text(lines, x + 3, y + 11, { maxWidth: columns[index].width - 6 });
          x += columns[index].width;
        });
        y += rowHeight;
      }
      const filename = query ? 'Invoices-' + query.replace(/[^a-z0-9-]+/gi, '-') + '.pdf' : 'Invoice-Records.pdf';
      pdf.save(filename);
      showAppMessage(rows.length === 1 ? 'Invoice PDF downloaded.' : rows.length + ' invoice records exported to PDF.', 'success');
    } catch (error) {
      console.error('Records PDF export failed:', error);
      showAppMessage('Could not generate the records PDF. Please try again.', 'error');
    }

};
