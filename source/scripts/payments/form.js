  const updatePaymentType = () => {
    const paymentType = document.getElementById('paymentType').value;
    const isMetal = paymentType === 'metal';
    document.getElementById('paymentAmountField').style.display = isMetal ? 'none' : 'block';
    document.getElementById('paymentMetalFields').style.display = isMetal ? 'block' : 'none';
    document.querySelector('#paymentAmountField label').textContent = paymentType === 'self-expense' ? 'Self expense amount (₹) *' : 'Amount paid (₹) *';
    document.getElementById('paymentAmountInput').setAttribute('aria-required', String(!isMetal));
    ['paymentMetal', 'paymentWeight', 'paymentPurity'].forEach(id => document.getElementById(id).setAttribute('aria-required', String(isMetal)));
  };
  const updateFineWeight = () => {
    const weight = Math.max(Number(document.getElementById('paymentWeight').value) || 0, 0);
    const purity = Math.min(Math.max(Number(document.getElementById('paymentPurity').value) || 0, 0), 100);
    document.getElementById('paymentFineWeight').textContent = (weight * purity / 100).toFixed(3) + ' g';
  };
  document.getElementById('paymentType').addEventListener('change', updatePaymentType);
  ['paymentWeight', 'paymentPurity'].forEach(id => document.getElementById(id).addEventListener('input', updateFineWeight));
  document.getElementById('paymentForm').addEventListener('submit', async event => {
    event.preventDefault();
    const type = document.getElementById('paymentType').value;
    const payments = await getPayments();
    const savedAt = new Date().toISOString();
    const reason = document.getElementById('paymentReason').value.trim();
    if (type === 'amount' || type === 'self-expense') {
      const amountPaid = Number(document.getElementById('paymentAmountInput').value);
      if (!(amountPaid > 0)) { toast('Amount is required and must be greater than 0.'); document.getElementById('paymentAmountInput').focus(); return; }
      payments.unshift({ id: Date.now().toString(), type, amount: amountPaid, reason, savedAt });
      await originalStorageSet('payment-records', JSON.stringify(payments));
      document.getElementById('paymentAmountInput').value = '';
    } else {
      const metal = document.getElementById('paymentMetal').value;
      const weight = Number(document.getElementById('paymentWeight').value);
      const purity = Number(document.getElementById('paymentPurity').value);
      if (!(weight > 0)) { toast('Gross weight is required and must be greater than 0.'); document.getElementById('paymentWeight').focus(); return; }
      if (!(purity > 0 && purity <= 100)) { toast('Purity is required and must be greater than 0% and no more than 100%.'); document.getElementById('paymentPurity').focus(); return; }
      const oldMetalEntries = await getOldGold();
      const balance = oldMetalEntries.filter(entry => entry.metal === metal).reduce((total, entry) => total + (Number(entry.weight) || 0), 0);
      if (weight > balance) { alert('Only ' + balance.toFixed(3) + ' g of old ' + metal + ' is available for payment.'); return; }
      const fineWeight = weight * purity / 100;
      const payment = { id: Date.now().toString(), type: 'metal', metal, weight, purity, fineWeight, reason, savedAt };
      payments.unshift(payment);
      await originalStorageSet('payment-records', JSON.stringify(payments));
      await addOldGold({ sourceId: 'payment:' + payment.id, metal, source: 'Metal payment', invoice: '—', customer: '—', date: new Date(savedAt).toLocaleDateString('en-GB'), weight: -weight, rate: 0, value: 0, receivedAt: savedAt });
      document.getElementById('paymentWeight').value = '';
      document.getElementById('paymentPurity').value = '';
      updateFineWeight();
    }
    document.getElementById('paymentReason').value = '';
    await renderPayments();
  });
  updatePaymentType();
  updateFineWeight();
