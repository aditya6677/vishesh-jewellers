  const transactionModal = document.createElement('div');
  transactionModal.className = 'modal-backdrop';
  transactionModal.id = 'transactionModal';
  document.body.appendChild(transactionModal);
  let activeTransaction = null;
  const closeTransactionModal = () => { transactionModal.classList.remove('open'); activeTransaction = null; };
  const openTransactionEditor = (kind, entry) => {
    activeTransaction = { kind, id: entry.id };
    const isPayment = kind === 'payment';
    const isMetalPayment = isPayment && entry.type === 'metal';
    const typeOptions = isPayment ? '<div class="field"><label>Payment type</label><select id="transactionType"><option value="amount" ' + (entry.type === 'amount' ? 'selected' : '') + '>Amount</option><option value="self-expense" ' + (entry.type === 'self-expense' ? 'selected' : '') + '>Self Expense</option><option value="metal" ' + (entry.type === 'metal' ? 'selected' : '') + '>Metal to Metal</option></select></div>' : '';
    transactionModal.innerHTML = '<div class="modal" style="max-width:560px;"><div class="toolbar"><h3 style="margin:0;">Edit ' + (isPayment ? 'Payment' : 'Purchase') + '</h3><button class="btn btn-ghost btn-sm" id="closeTransactionModal">Close</button></div><div class="form-grid">' + typeOptions + '<div class="field transaction-metal"><label>Metal</label><select id="transactionMetal"><option value="gold" ' + (entry.metal === 'gold' ? 'selected' : '') + '>Gold</option><option value="silver" ' + (entry.metal === 'silver' ? 'selected' : '') + '>Silver</option></select></div><div class="field transaction-weight"><label>Weight (g)</label><input id="transactionWeight" type="number" min="0.001" step="0.001" value="' + (Number(entry.weight) || 0) + '"></div><div class="field transaction-purity"><label>Purity (%)</label><input id="transactionPurity" type="number" min="0" max="100" step="0.01" value="' + (Number(entry.purity) || 0) + '"></div><div class="field transaction-rate"><label>Rate per gram (₹)</label><input id="transactionRate" type="number" min="0.01" step="0.01" value="' + (Number(entry.rate) || 0) + '"></div><div class="field transaction-amount"><label>Amount (₹)</label><input id="transactionAmount" type="number" min="0.01" step="0.01" value="' + (Number(entry.amount) || 0) + '"></div><div class="field transaction-reason"><label>Reason (optional)</label><input id="transactionReason" type="text" value="' + safe(entry.reason || '') + '"></div></div><div class="btn-row" style="margin-top:18px;"><button class="btn btn-gold" id="saveTransaction">Save Changes</button><button class="btn btn-ghost" id="cancelTransaction">Cancel</button></div></div>';
    const updateFields = () => {
      const type = isPayment ? document.getElementById('transactionType').value : 'purchase';
      const metal = type === 'metal';
      transactionModal.querySelectorAll('.transaction-metal, .transaction-weight').forEach(field => { field.style.display = (metal || !isPayment) ? '' : 'none'; });
      transactionModal.querySelector('.transaction-purity').style.display = metal ? '' : 'none';
      transactionModal.querySelector('.transaction-rate').style.display = isPayment ? 'none' : '';
      transactionModal.querySelector('.transaction-amount').style.display = metal || !isPayment ? 'none' : '';
      transactionModal.querySelector('.transaction-reason').style.display = isPayment ? '' : 'none';
      const requiredFields = {
        '.transaction-metal': metal || !isPayment,
        '.transaction-weight': metal || !isPayment,
        '.transaction-purity': metal,
        '.transaction-rate': !isPayment,
        '.transaction-amount': isPayment && !metal
      };
      Object.entries(requiredFields).forEach(([selector, required]) => {
        const field = transactionModal.querySelector(selector);
        const label = field.querySelector('label');
        label.textContent = label.textContent.replace(/ *$/, '') + (required ? ' *' : '');
        field.querySelector('input, select').setAttribute('aria-required', String(required));
      });
      if (isPayment) {
        const typeField = document.getElementById('transactionType');
        typeField.setAttribute('aria-required', 'true');
        typeField.closest('.field').querySelector('label').textContent = 'Payment type *';
      }
      if (!isPayment) {
        const value = (Number(document.getElementById('transactionWeight').value) || 0) * (Number(document.getElementById('transactionRate').value) || 0);
        document.getElementById('transactionAmount').value = value.toFixed(2);
      }
    };
    if (isPayment) document.getElementById('transactionType').addEventListener('change', updateFields);
    ['transactionWeight', 'transactionRate'].forEach(id => document.getElementById(id).addEventListener('input', updateFields));
    document.getElementById('closeTransactionModal').addEventListener('click', closeTransactionModal);
    document.getElementById('cancelTransaction').addEventListener('click', closeTransactionModal);
    updateFields();
    transactionModal.classList.add('open');
  };
  const openTransactionDelete = (kind, entry) => {
    activeTransaction = { kind: kind + '-delete', id: entry.id };
    transactionModal.innerHTML = '<div class="modal" style="max-width:480px;"><div class="toolbar"><h3 style="margin:0;">Delete ' + (kind === 'payment' ? 'Payment' : 'Purchase') + '</h3><button class="btn btn-ghost btn-sm" id="closeTransactionModal">Close</button></div><p class="void-modal-note">This will permanently remove the entry and reverse its linked old-metal balance, if applicable.</p><div class="btn-row" style="margin-top:18px;"><button class="btn btn-danger" id="confirmTransactionDelete">Delete</button><button class="btn btn-ghost" id="cancelTransaction">Cancel</button></div></div>';
    document.getElementById('closeTransactionModal').addEventListener('click', closeTransactionModal);
    document.getElementById('cancelTransaction').addEventListener('click', closeTransactionModal);
    transactionModal.classList.add('open');
  };
  transactionModal.addEventListener('click', async event => {
    if (!activeTransaction) return;
    const isDelete = activeTransaction.kind.endsWith('-delete');
    if ((isDelete && event.target.id !== 'confirmTransactionDelete') || (!isDelete && event.target.id !== 'saveTransaction')) return;
    const kind = activeTransaction.kind.replace('-delete', '');
    const id = activeTransaction.id;
    if (kind === 'payment') {
      const payments = await getPayments();
      const payment = payments.find(entry => entry.id === id);
      if (!payment) { closeTransactionModal(); return; }
      if (isDelete) {
        await originalStorageSet('payment-records', JSON.stringify(payments.filter(entry => entry.id !== id)));
        const oldMetal = await getOldGold();
        await originalStorageSet('old-gold-records', JSON.stringify(oldMetal.filter(entry => entry.sourceId !== 'payment:' + id)));
      } else {
        const type = document.getElementById('transactionType').value;
        const reason = document.getElementById('transactionReason').value.trim();
        const oldMetal = await getOldGold();
        const revisedOldMetal = oldMetal.filter(entry => entry.sourceId !== 'payment:' + id);
        if (type === 'metal') {
          const metal = document.getElementById('transactionMetal').value;
          const weight = Number(document.getElementById('transactionWeight').value);
          const purity = Number(document.getElementById('transactionPurity').value);
          const available = revisedOldMetal.filter(entry => entry.metal === metal).reduce((sum, entry) => sum + (Number(entry.weight) || 0), 0);
          if (!(weight > 0)) { toast('Gross weight is required and must be greater than 0.'); document.getElementById('transactionWeight').focus(); return; }
          if (!(purity > 0 && purity <= 100)) { toast('Purity is required and must be greater than 0% and no more than 100%.'); document.getElementById('transactionPurity').focus(); return; }
          if (weight > available + 0.0001) { toast('Only ' + available.toFixed(3) + ' g of old ' + metal + ' is available for payment.'); document.getElementById('transactionWeight').focus(); return; }
          Object.assign(payment, { type, metal, weight, purity, fineWeight: weight * purity / 100, amount: 0, reason });
          revisedOldMetal.unshift({ sourceId: 'payment:' + id, metal, source: 'Metal payment', invoice: '—', customer: '—', date: new Date(payment.savedAt).toLocaleDateString('en-GB'), weight: -weight, rate: 0, value: 0, receivedAt: payment.savedAt });
        } else {
          const paymentAmount = Number(document.getElementById('transactionAmount').value);
          if (!(paymentAmount > 0)) { toast('Amount is required and must be greater than 0.'); document.getElementById('transactionAmount').focus(); return; }
          Object.assign(payment, { type, amount: paymentAmount, reason });
          delete payment.metal; delete payment.weight; delete payment.purity; delete payment.fineWeight;
        }
        await originalStorageSet('payment-records', JSON.stringify(payments));
        await originalStorageSet('old-gold-records', JSON.stringify(revisedOldMetal));
      }
      await renderPayments();
    } else {
      const purchases = await getPurchases();
      const purchase = purchases.find(entry => entry.id === id);
      if (!purchase) { closeTransactionModal(); return; }
      if (isDelete) {
        await originalStorageSet('purchase-records', JSON.stringify(purchases.filter(entry => entry.id !== id)));
        const oldMetal = await getOldGold();
        await originalStorageSet('old-gold-records', JSON.stringify(oldMetal.filter(entry => entry.sourceId !== 'purchase:' + id)));
      } else {
        const metal = document.getElementById('transactionMetal').value;
        const weight = Number(document.getElementById('transactionWeight').value);
        const rate = Number(document.getElementById('transactionRate').value);
        if (!(weight > 0)) { toast('Purchase weight is required and must be greater than 0.'); document.getElementById('transactionWeight').focus(); return; }
        if (!(rate > 0)) { toast('Purchase rate per gram is required and must be greater than 0.'); document.getElementById('transactionRate').focus(); return; }
        const purchaseAmount = weight * rate;
        Object.assign(purchase, { metal, weight, rate, amount: purchaseAmount });
        const oldMetal = await getOldGold();
        const revisedOldMetal = oldMetal.filter(entry => entry.sourceId !== 'purchase:' + id);
        revisedOldMetal.unshift({ sourceId: 'purchase:' + id, metal, source: 'Old metal purchase', invoice: '—', customer: '—', date: new Date(purchase.savedAt).toLocaleDateString('en-GB'), weight, rate, value: purchaseAmount, receivedAt: purchase.savedAt });
        await originalStorageSet('purchase-records', JSON.stringify(purchases));
        await originalStorageSet('old-gold-records', JSON.stringify(revisedOldMetal));
      }
      await renderPurchases();
    }
    if (document.getElementById('page-dashboard').classList.contains('active')) await renderDashboard();
    closeTransactionModal();
  });
