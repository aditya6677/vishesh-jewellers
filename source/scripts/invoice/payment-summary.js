  const paymentRow = document.createElement('div');
  paymentRow.className = 'row row-3';
  paymentRow.id = 'invoicePaymentRow';
  paymentRow.style.marginTop = '16px';
  paymentRow.innerHTML = '<div class="field"><label>Discount (₹)</label><input type="number" id="invoice-discount" value="0" min="0" step="0.01" placeholder="0.00"></div><div class="field"><label>Amount Paid (₹)</label><input type="number" id="amount-paid" value="0" min="0" step="0.01" placeholder="0.00"></div><div class="field"><label id="amount-balance-label">Amount Due (₹)</label><div id="amount-balance" class="payment-balance">₹0.00</div></div>';
  const totalsMini = document.querySelector('.totals-mini');
  totalsMini.parentNode.insertBefore(paymentRow, totalsMini);
  const updatePaymentSummary = () => {
    const total = amount(document.getElementById('mini-grand').textContent);
    const paid = Math.max(amount(document.getElementById('amount-paid').value), 0);
    const difference = total - paid;
    const isDue = difference >= 0;
    document.getElementById('amount-balance-label').textContent = isDue ? 'Amount Due (₹)' : 'Excess / Plus Amount (₹)';
    document.getElementById('amount-balance').textContent = money(Math.abs(difference));
    const totals = document.getElementById('p-totals');
    const existing = totals.querySelector('.payment-summary-line');
    if (existing) existing.remove();
    const line = document.createElement('div');
    line.className = 'tl payment-summary-line';
    line.innerHTML = '<span>' + (isDue ? 'Amount Due' : 'Excess / Plus Amount') + '</span><b>₹' + money(Math.abs(difference)).replace('₹', '') + '</b>';
    totals.appendChild(line);
  };
  document.getElementById('amount-paid').addEventListener('input', updatePaymentSummary);
  document.getElementById('invoice-discount').addEventListener('input', updateExchangeValue);
  document.addEventListener('input', event => {
    if (event.target.id !== 'amount-paid') setTimeout(updatePaymentSummary, 0);
  });
  document.addEventListener('change', event => {
    if (event.target.id !== 'amount-paid') setTimeout(updatePaymentSummary, 0);
  });
  document.getElementById('btnNewInvoice').addEventListener('click', async () => {
    const previousInvoiceNumber = invoiceNumberInput.value;
    for (let attempt = 0; attempt < 40 && invoiceNumberInput.value === previousInvoiceNumber; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    document.getElementById('amount-paid').value = '0';
    document.getElementById('invoice-discount').value = '0';
    exchangeRows.innerHTML = '';
    addExchangeRow();
    document.getElementById('gst-rate').value = '1.5';
    updateExchangeValue();
    updatePaymentSummary();
  });
  window.addEventListener('load', updatePaymentSummary);
