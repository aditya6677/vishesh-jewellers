  let pendingRecord = null;
  const originalStorageSet = window.storage.set.bind(window.storage);
  const savePendingRecord = async () => {
    if (!pendingRecord) return;
    const record = pendingRecord;
    pendingRecord = null;
    const records = await getRecords();
    const existing = records.findIndex(saved => saved.number === record.number);
    if (existing >= 0) {
      record.paid = Number(records[existing].paid) || 0;
      record.due = Number(records[existing].due) || 0;
      record.payments = records[existing].payments || [];
      records[existing] = record;
    } else records.unshift(record);
    await originalStorageSet('invoice-records', JSON.stringify(records));
    const exchanges = Array.isArray(record.exchanges) ? record.exchanges : record.exchange ? [record.exchange] : [];
    for (const exchange of exchanges) {
      if (!exchange || !['gold', 'silver'].includes(exchange.metal) || !(Number(exchange.weight) > 0)) continue;
      await addOldGold({ sourceId: record.number + ':exchange:' + exchange.metal, metal: exchange.metal, source: 'Invoice exchange', invoice: record.number, customer: record.customer, date: record.date, weight: Number(exchange.weight), rate: Number(exchange.rate), value: Number(exchange.value), receivedAt: record.savedAt });
    }
    showInvoiceSuccess(record);
    if (document.getElementById('page-records').classList.contains('active')) renderRecords();
  };
  window.storage.set = async (key, value) => {
    const result = await originalStorageSet(key, value);
    if (key === 'stock-list') {
      const completedInvoice = Boolean(pendingRecord);
      await savePendingRecord();
      // This runs after the stock and invoice record have both been saved. The
      // existing New Invoice handler increments and persists the counter.
      if (completedInvoice) setTimeout(() => document.getElementById('btnNewInvoice').click(), 0);
    }
    return result;
  };

  const collectInvoiceRecord = status => {
    const paid = amount(document.getElementById('amount-paid').value);
    return {
      number: document.getElementById('inv-no').value || '—',
      date: document.getElementById('p-date').textContent || '—',
      weightMode: 'line-total',
      invoiceDate: document.getElementById('inv-date').value || '',
      status,
      customer: document.getElementById('cust-name').value || 'Walk-in customer',
      mobile: document.getElementById('cust-mobile').value || '',
      address: document.getElementById('cust-address').value || '',
      business: document.getElementById('biz-name').value || 'Vishesh Jewellers',
      gstin: document.getElementById('biz-gstin').value || '',
      terms: document.getElementById('inv-terms').value || '',
      items: Array.from(document.querySelectorAll('#p-items-body tr')).map(row => row.cells[1] ? row.cells[1].textContent.trim() : '').filter(Boolean).join(', '),
      subtotal: document.getElementById('mini-sub').textContent || '₹0.00',
      discount: document.getElementById('mini-disc').textContent || '₹0.00',
      tax: document.getElementById('mini-gst').textContent || '₹0.00',
      total: document.getElementById('mini-grand').textContent || '₹0.00',
      soldItems: rows.filter(row => row.stockId).map(row => ({ lineId: row.id, stockId: row.stockId, name: row.name, hsn: row.hsn || '', purity: row.purity, gross: Number(row.gross) || 0, net: Number(row.net) || 0, pcs: Number(row.pcs) || 1, rate: Number(row.rate) || 0, making: Number(row.making) || 0 })),
      exchanges: getExchangeEntries().filter(exchange => exchange.weight > 0),
      manualDiscount: Math.max(Number(document.getElementById('invoice-discount').value) || 0, 0),
      gstRate: Number(document.getElementById('gst-rate').value) * 2 || 0,
      initialPaid: paid,
      paid,
      due: Math.max(amount(document.getElementById('mini-grand').textContent) - paid, 0),
      payments: paid > 0 ? [{ method: 'amount', amount: paid, initialPayment: true, settledAt: new Date().toISOString() }] : [],
      invoiceMarkup: document.getElementById('invoicePaper').outerHTML,
      savedAt: new Date().toISOString()
    };
  };
  document.getElementById('btnSavePendingOrder').addEventListener('click', async () => {
    const customer = document.getElementById('cust-name').value.trim();
    const enteredOrderItems = rows.filter(row => String(row.name || '').trim() || row.gross !== '' || row.net !== '' || row.rate !== '');
    if (!customer) { toast('Customer name is required for a pending order.'); document.getElementById('cust-name').focus(); return; }
    if (!document.getElementById('inv-date').value) { toast('Invoice date is required for a pending order.'); document.getElementById('inv-date').focus(); return; }
    if (!enteredOrderItems.length) { toast('Add at least one ordered item.'); return; }
    for (const row of enteredOrderItems) {
      const rowElement = Array.from(document.querySelectorAll('#itemsTbody tr')).find(element => element.dataset.id === row.id);
      const required = [
        [row.name, '.f-name', 'Item name'],
        [Number(row.gross) > 0, '.f-gross', 'Gross weight'],
        [Number(row.net) > 0, '.f-net', 'Net weight'],
        [Number.isInteger(Number(row.pcs)) && Number(row.pcs) >= 1, '.f-pcs', 'Quantity (Pcs)'],
        [Number(row.rate) > 0, '.f-rate', 'Rate per gram']
      ].find(([valid]) => !valid);
      if (required) { toast(required[2] + ' is required for every pending-order item.'); if (rowElement) rowElement.querySelector(required[1]).focus(); return; }
      if (Number(row.net) > Number(row.gross)) { toast('Net weight cannot be greater than gross weight.'); if (rowElement) rowElement.querySelector('.f-net').focus(); return; }
    }
    const orderItems = enteredOrderItems;
    const record = collectInvoiceRecord('pending');
    record.orderItems = orderItems.map((row, index) => ({ lineId: row.id || ('order-' + index), stockId: '', name: row.name, hsn: row.hsn || '', purity: row.purity || '', gross: Number(row.gross) || 0, net: Number(row.net) || 0, pcs: Number(row.pcs) || 1, rate: Number(row.rate) || 0, making: Number(row.making) || 0 }));
    record.soldItems = [];
    const records = await getRecords();
    records.unshift(record);
    await originalStorageSet('invoice-records', JSON.stringify(records));
    const oldMetal = await getOldGold();
    record.exchanges.forEach((exchange, index) => {
      if (Number(exchange.weight) > 0) oldMetal.unshift({ sourceId: record.number + ':exchange:' + exchange.metal + ':' + index, metal: exchange.metal, source: 'Invoice exchange', invoice: record.number, customer: record.customer, date: record.date, weight: Number(exchange.weight), rate: Number(exchange.rate), value: Number(exchange.value), receivedAt: record.savedAt });
    });
    await originalStorageSet('old-gold-records', JSON.stringify(oldMetal));
    if (document.getElementById('page-records').classList.contains('active')) await renderRecords();
    showInvoiceSuccess(record);
    document.getElementById('btnNewInvoice').click();
  });
  document.getElementById('btnCompleteSale').addEventListener('click', event => {
    pendingRecord = collectInvoiceRecord('completed');
    setTimeout(async () => {
      if (pendingRecord && document.getElementById('saleStatus').textContent.startsWith('✔ Stock updated')) await savePendingRecord();
      else if (pendingRecord) pendingRecord = null;
    }, 500);
  }, true);
