  const voidModal = document.createElement('div');
  voidModal.id = 'voidInvoiceModal';
  voidModal.className = 'modal-backdrop';
  voidModal.innerHTML = '<div class="modal" style="max-width:520px;"><div class="toolbar"><h3 style="margin:0;">Void invoice</h3><button class="btn btn-ghost btn-sm" id="closeVoidInvoice">Close</button></div><p class="void-modal-note" id="voidInvoiceNote"></p><div class="field"><label>Reason for voiding *</label><input id="voidInvoiceReason" type="text" required aria-required="true" placeholder="e.g. Sale cancelled by customer"></div><div class="btn-row" style="margin-top:18px;"><button class="btn btn-gold" id="confirmVoidInvoice">Void invoice</button><button class="btn btn-ghost" id="cancelVoidInvoice">Cancel</button></div></div>';
  document.body.appendChild(voidModal);
  let activeVoidIndex = null;
  const closeVoidModal = () => { voidModal.classList.remove('open'); activeVoidIndex = null; };
  const openVoidModal = (record, index) => {
    if (record.status !== 'pending' && (!Array.isArray(record.soldItems) || !record.soldItems.length)) {
      alert('This older invoice does not have the stock-line details needed to safely void it.');
      return;
    }
    activeVoidIndex = index;
    document.getElementById('voidInvoiceReason').value = '';
    document.getElementById('voidInvoiceNote').textContent = record.status === 'pending' ? 'Pending order ' + record.number + ' will be cancelled. No stock has been deducted; linked old-metal exchange/settlement entries will be reversed.' : 'VJ invoice ' + record.number + ' will be marked void. Sold stock will be restored and linked old-metal exchange/settlement entries will be reversed. This cannot be undone from the app.';
    voidModal.classList.add('open');
  };
  document.getElementById('closeVoidInvoice').addEventListener('click', closeVoidModal);
  document.getElementById('cancelVoidInvoice').addEventListener('click', closeVoidModal);
  document.getElementById('confirmVoidInvoice').addEventListener('click', async () => {
    const reason = document.getElementById('voidInvoiceReason').value.trim();
    if (!reason) { alert('Enter a reason before voiding this invoice.'); return; }
    const records = await getRecords();
    const record = records[activeVoidIndex];
    if (!record || record.status === 'voided') { closeVoidModal(); return; }
    const stockResult = await window.storage.get('stock-list');
    const stockList = stockResult ? JSON.parse(stockResult.value || '[]') : [];
    for (const item of record.soldItems) {
      if (!stockList.find(stock => String(stock.id) === String(item.stockId))) {
        alert('The original stock item “' + item.name + '” no longer exists. The invoice was not voided.');
        return;
      }
    }
    record.soldItems.forEach(item => {
      const stock = stockList.find(stockItem => String(stockItem.id) === String(item.stockId));
      const pcs = Number(item.pcs) || 1;
      stock.qty = (Number(stock.qty) || 0) + pcs;
      const weightMultiplier = record.weightMode === 'line-total' ? 1 : pcs;
      stock.net = (Number(stock.net) || 0) + (Number(item.net) || 0) * weightMultiplier;
      stock.gross = (Number(stock.gross) || 0) + (Number(item.gross) || 0) * weightMultiplier;
    });
    const oldMetalEntries = await getOldGold();
    const reversals = oldMetalEntries.filter(entry => entry.invoice === record.number && ['Invoice exchange', 'Gold settlement', 'Silver settlement'].includes(entry.source));
    const voidedAt = new Date().toISOString();
    record.status = 'voided';
    record.voidedAt = voidedAt;
    record.voidReason = reason;
    record.due = 0;
    await originalStorageSet('stock-list', JSON.stringify(stockList));
    await originalStorageSet('invoice-records', JSON.stringify(records));
    for (const entry of reversals) {
      await addOldGold({ sourceId: 'void:' + entry.sourceId, metal: entry.metal, source: 'Invoice void reversal', invoice: record.number, customer: record.customer, date: new Date(voidedAt).toLocaleDateString('en-GB'), weight: -(Number(entry.weight) || 0), rate: Number(entry.rate) || 0, value: -(Number(entry.value) || 0), receivedAt: voidedAt });
    }
    closeVoidModal();
    await renderRecords();
    if (document.getElementById('page-dashboard').classList.contains('active')) await renderDashboard();
  });
