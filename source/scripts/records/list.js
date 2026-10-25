  const deleteRecordDialog = document.createElement('dialog');
  deleteRecordDialog.style.cssText = 'width:min(460px,90vw);border:1px solid #9a554a;border-radius:14px;padding:26px;background:#211b13;color:#eee1c6;';
  deleteRecordDialog.innerHTML = '<h3 style="margin-top:0">Delete invoice?</h3><p id="deleteRecordNote" style="line-height:1.6"></p><div class="btn-row"><button class="btn btn-danger" id="confirmRecordDeletion">Delete invoice</button><button class="btn btn-ghost" id="cancelRecordDeletion">Cancel</button></div>';
  document.body.appendChild(deleteRecordDialog);
  let deletionNumber = null;
  document.getElementById('cancelRecordDeletion').onclick = () => deleteRecordDialog.close();
  document.getElementById('confirmRecordDeletion').onclick = async () => {
    const button = document.getElementById('confirmRecordDeletion');
    button.disabled = true;
    document.getElementById('cancelRecordDeletion').disabled = true;
    try {
      const response = await fetch('/api/invoices/' + encodeURIComponent(deletionNumber), { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not delete invoice.');
      const latestStock = await window.storage.get('stock-list');
      stockList = latestStock ? JSON.parse(latestStock.value) : [];
      renderStockTable(); renderStockStats(); renderRowsTable();
      await renderRecords();
      deleteRecordDialog.close();
      showAppMessage('Invoice ' + deletionNumber + ' deleted and its calculations reversed. This deletion cannot be undone from the app.', 'success');
    } catch (error) {
      deleteRecordDialog.close();
      showAppMessage(error.message, 'error');
    } finally {
      button.disabled = false;
      document.getElementById('cancelRecordDeletion').disabled = false;
    }
  };
  const renderRecords = async () => {
    const query = (document.getElementById('recordSearch').value || '').trim().toLowerCase();
    const records = await getRecords();
    const statusFilter = document.getElementById('recordStatusFilter').value;
    const from = document.getElementById('recordFrom').value;
    const to = document.getElementById('recordTo').value;
    const filtered = records.map((record, index) => ({ record, index })).filter(({ record }) => recordMatchesFilters(record, query, statusFilter, from, to));
    document.getElementById('recordCountLabel').textContent = filtered.length + ' of ' + records.length + ' shown';
    document.getElementById('recordsTbody').innerHTML = filtered.map(entry => {
      const record = entry.record;
      const index = entry.index;
      const due = Number(record.due) || 0;
      const paid = Number(record.paid) || 0;
      const netTotal = recordNetTotal(record);
      const plus = due <= 0 ? Math.max(paid - netTotal, 0) : 0;
      const balanceLabel = plus > 0 ? 'Plus amount' : 'Amount due';
      const balanceValue = plus > 0 ? plus : due;
      const balanceClass = plus > 0 ? 'plus-amount' : 'due-amount';
      const voided = record.status === 'voided';
      const pending = record.status === 'pending';
      const exchanges = Array.isArray(record.exchanges) ? record.exchanges : record.exchange ? [record.exchange] : [];
      const exchangeHistory = exchanges.map(exchange => {
        const metal = String(exchange.metal || 'gold').replace(/^./, character => character.toUpperCase());
        return safe(metal + ' · ' + (Number(exchange.weight) || 0).toFixed(3) + ' g × ' + money(exchange.rate) + '/g = ' + money(exchange.value));
      }).join('<br>') || 'No old metal exchanged';
      const settlementHistory = (record.payments || []).map(payment => {
        const method = payment.method === 'gold' ? 'Gold' : payment.method === 'silver' ? 'Silver' : 'Amount';
        const itemDetail = payment.weight ? ' · ' + payment.weight + 'g × ₹' + payment.rate + '/g' : '';
        return safe(method + itemDetail + ' — ' + money(payment.amount));
      }).join('<br>') || 'No settlement recorded';
      return '<tr class="' + (voided ? 'voided-record' : '') + '"><td style="font-family:var(--font-mono);">' + safe(record.number) + (voided ? '<span class="voided-badge">VOIDED</span>' : pending ? '<span class="pending-badge">PENDING</span>' : '') + '</td><td>' + safe(record.date) + '</td><td>' + safe(record.customer || 'Walk-in customer') + '</td><td>' + safe(record.mobile || '—') + '</td><td style="font-family:var(--font-mono); color:var(--gold-pale);">' + money(netTotal) + '</td><td><span class="' + balanceClass + '">' + (plus > 0 ? '+' : '') + money(balanceValue) + '</span></td><td><button class="btn btn-ghost btn-sm record-toggle" data-index="' + index + '">Details</button></td></tr>' +
        '<tr class="record-detail" data-detail="' + index + '" style="display:none;"><td colspan="7"><div class="record-detail-card"><div class="record-info-grid"><div class="record-info"><b>Customer address</b>' + safe(record.address || '—') + '</div><div class="record-info"><b>' + (pending ? 'Ordered items' : 'Items') + '</b>' + safe(record.items || '—') + '</div><div class="record-info"><b>Old metal exchange</b>' + exchangeHistory + '</div><div class="record-info"><b>Net invoice total</b><span class="paid-amount">' + money(netTotal) + '</span></div><div class="record-info"><b>Paid</b><span class="paid-amount">' + money(paid) + '</span></div><div class="record-info"><b>' + balanceLabel + '</b><span class="' + balanceClass + '">' + (plus > 0 ? '+' : '') + money(balanceValue) + '</span></div>' + (voided ? '<div class="record-info"><b>Void reason</b>' + safe(record.voidReason || '—') + '</div>' : pending ? '<div class="record-info"><b>Order status</b>Awaiting stock selection and delivery</div>' : '') + '<div class="record-info"><b>Payment / settlement history</b>' + settlementHistory + '</div></div>' + (voided ? '<div class="voided-invoice-view"><button class="btn btn-ghost btn-sm record-reprint" data-index="' + index + '">View Voided Invoice</button></div>' : '') + '<div class="record-actions"><div class="field"><label>Settlement type *</label><select class="record-method" data-index="' + index + '" aria-required="' + (due > 0 && !voided) + '" ' + (due <= 0 || voided ? 'disabled' : '') + '><option value="amount">Amount / Cash</option><option value="gold">Gold item</option><option value="silver">Silver item</option></select></div><div class="field" data-amount-field="' + index + '"><label>Settle amount (₹) *</label><input type="number" min="0.01" step="0.01" id="settlement-' + index + '" aria-required="' + (due > 0 && !voided) + '" placeholder="Enter received amount" ' + (due <= 0 || voided ? 'disabled' : '') + '></div><div class="field" data-item-field="' + index + '" style="display:none;"><label>Weight (g) *</label><input type="number" min="0.001" step="0.001" id="settlement-weight-' + index + '" aria-required="false" placeholder="0.000" ' + (due <= 0 || voided ? 'disabled' : '') + '></div><div class="field" data-item-field="' + index + '" style="display:none;"><label>Price per gram (₹) *</label><input type="number" min="0.01" step="0.01" id="settlement-rate-' + index + '" aria-required="false" placeholder="0.00" ' + (due <= 0 || voided ? 'disabled' : '') + '></div><div class="field" data-item-field="' + index + '" style="display:none;"><label>Calculated settlement (₹)</label><div class="payment-balance" id="settlement-value-' + index + '">₹0.00</div></div><button class="btn btn-gold btn-sm record-settle" data-index="' + index + '" ' + (due <= 0 || voided ? 'disabled' : '') + '>Settle Amount</button><button class="btn btn-ghost btn-sm record-paid" data-index="' + index + '" ' + (due <= 0 || voided ? 'disabled' : '') + '>Mark Fully Paid</button><button class="btn btn-ghost btn-sm record-edit" data-index="' + index + '" ' + (voided ? 'disabled' : '') + '>' + (pending ? 'Deliver Order' : 'Edit Invoice') + '</button><button class="btn btn-ghost btn-sm record-void" data-index="' + index + '" ' + (voided ? 'disabled' : '') + '>' + (pending ? 'Cancel Order' : 'Void Invoice') + '</button><button class="btn btn-ghost btn-sm record-reprint" data-index="' + index + '">' + (pending ? 'View Pending Invoice' : 'Regenerate Invoice') + '</button></div></div></td></tr>';
    }).join('');
    window.refreshTablePagination('recordsTbody');
    filtered.forEach(({ record, index }) => {
      const card = document.querySelector('[data-detail="' + index + '"] .record-detail-card');
      const button = document.createElement('button');
      button.className = 'btn btn-danger btn-sm';
      button.style.cssText = 'margin-top:14px;color:#E8A99E;border-color:#9a554a;background:rgba(164,44,35,.16)';
      button.textContent = 'Delete Record';
      button.onclick = () => {
        deletionNumber = record.number;
        document.getElementById('deleteRecordNote').textContent = 'Permanently delete ' + record.number + '? Its sales, payments and dues will be removed, remaining sold weight restored, and linked old-metal entries removed. Already-voided invoices will not restore stock twice. This cannot be undone from the app.';
        deleteRecordDialog.showModal();
      };
      card.appendChild(button);
    });
    const emptyState = document.getElementById('recordsEmpty');
    emptyState.style.display = filtered.length ? 'none' : 'block';
    const statusLabel = document.getElementById('recordStatusFilter').selectedOptions[0].textContent.toLowerCase();
    emptyState.textContent = !records.length ? 'No invoices recorded yet.' : statusFilter !== 'all' ? 'No ' + statusLabel + ' records match your filters.' : 'No records match your filters.';
  };
  document.getElementById('exportRecordsPdf').addEventListener('click', async () => {
    const query = (document.getElementById('recordSearch').value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('recordStatusFilter').value;
    const from = document.getElementById('recordFrom').value;
    const to = document.getElementById('recordTo').value;
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
      pdf.text(rows.length + ' invoice' + (rows.length === 1 ? '' : 's') + (query ? ' | Search: ' + query : '') + ' | Status: ' + document.getElementById('recordStatusFilter').selectedOptions[0].textContent + (from || to ? ' | Invoice dates: ' + (from || 'Beginning') + ' to ' + (to || 'Present') : '') + ' | Generated: ' + new Date().toLocaleString('en-IN'), margin, 42, { maxWidth: pageWidth - margin * 2 });
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
  });
