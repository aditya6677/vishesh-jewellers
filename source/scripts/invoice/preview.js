  const regeneratedModal = document.createElement('div');
  regeneratedModal.id = 'regeneratedInvoiceModal';
  regeneratedModal.className = 'modal-backdrop';
  regeneratedModal.innerHTML = '<div class="modal" style="max-width:900px; max-height:92vh; overflow:auto;"><div class="toolbar"><h3 id="regeneratedInvoiceTitle" style="margin:0;">Regenerated Invoice</h3><button class="btn btn-ghost btn-sm" id="closeRegeneratedInvoice">Close</button></div><div class="btn-row" style="margin:0 0 16px;"><button class="btn btn-gold btn-sm" id="printRegeneratedInvoice">🖨 Print Invoice</button><button class="btn btn-ghost btn-sm" id="downloadRegeneratedInvoice">⬇ Download PDF</button></div><div class="paper-outer" style="position:static;"><div id="regeneratedInvoiceContent"></div></div></div>';
  document.body.appendChild(regeneratedModal);
  document.getElementById('closeRegeneratedInvoice').addEventListener('click', () => regeneratedModal.classList.remove('open'));
  const reprintInvoice = record => {
    const fallback = '<div id="invoicePaper"><h2>Vishesh Jewellers</h2><p>Invoice: ' + safe(record.number) + '</p><p>Date: ' + safe(record.date) + '</p><p>Customer: ' + safe(record.customer) + '</p><p>Mobile: ' + safe(record.mobile || '—') + '</p><p>Items: ' + safe(record.items) + '</p><h3>Total: ' + safe(record.total) + '</h3></div>';
    document.getElementById('regeneratedInvoiceTitle').textContent = 'Invoice ' + record.number;
    document.getElementById('regeneratedInvoiceContent').innerHTML = record.invoiceMarkup || fallback;
    const paper = document.querySelector('#regeneratedInvoiceContent #invoicePaper');
    // Older saved invoice markup may still contain the retired circular seal.
    paper.querySelectorAll('#p-seal, .seal').forEach(element => element.remove());
    paper.querySelectorAll('.voided-invoice-watermark, .pending-invoice-watermark').forEach(element => element.remove());
    if (record.status === 'voided') {
      const watermark = document.createElement('div');
      watermark.className = 'voided-invoice-watermark';
      watermark.textContent = 'VOIDED';
      paper.appendChild(watermark);
    }
    if (record.status === 'pending') {
      const watermark = document.createElement('div');
      watermark.className = 'pending-invoice-watermark';
      watermark.textContent = 'PENDING DELIVERY';
      paper.appendChild(watermark);
    }
    const totals = paper.querySelector('#p-totals');
    if (totals) {
      totals.querySelectorAll('.payment-summary-line, .regenerated-payment-line').forEach(line => line.remove());
      const paid = Number(record.paid) || 0;
      const due = Number(record.due) || 0;
      const paymentLine = document.createElement('div');
      paymentLine.className = 'tl regenerated-payment-line';
      paymentLine.innerHTML = '<span>Amount Paid</span><b>₹' + money(paid).replace('₹', '') + '</b>';
      const dueLine = document.createElement('div');
      dueLine.className = 'tl regenerated-payment-line';
      dueLine.innerHTML = '<span>Amount Due</span><b>₹' + money(due).replace('₹', '') + '</b>';
      totals.appendChild(paymentLine);
      totals.appendChild(dueLine);
      const previousHistory = paper.querySelector('.regenerated-settlement-history');
      if (previousHistory) previousHistory.remove();
      const payments = (record.payments || []).map(payment => {
        const method = payment.method === 'gold' ? 'Gold' : payment.method === 'silver' ? 'Silver' : 'Amount';
        const detail = payment.weight ? ' (' + payment.weight + 'g × ₹' + payment.rate + '/g)' : '';
        return method + detail + ': ' + money(payment.amount);
      });
      const history = document.createElement('div');
      history.className = 'words-line regenerated-settlement-history';
      history.textContent = payments.length ? 'Settlement: ' + payments.join(' · ') : 'Settlement: No payment recorded';
      totals.insertAdjacentElement('afterend', history);
    }
    regeneratedModal.dataset.invoiceNumber = record.number;
    regeneratedModal.classList.add('open');
  };
