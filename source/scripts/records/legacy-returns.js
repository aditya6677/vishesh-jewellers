  const returnModal = document.createElement('div');
  returnModal.id = 'returnInvoiceModal';
  returnModal.className = 'modal-backdrop';
  returnModal.innerHTML = '<div class="modal" style="max-width:760px;"><div class="toolbar"><h3 style="margin:0;">Return items</h3><button class="btn btn-ghost btn-sm" id="closeReturnInvoice">Close</button></div><p class="muted" id="returnInvoiceLabel" style="margin:12px 0 0;"></p><div id="returnItems" class="return-items"></div><div class="return-summary"><span>Return / credit-note value</span><b id="returnAmount">₹0.00</b></div><div class="return-form-grid"><div class="field"><label>Adjustment</label><select id="returnMethod"><option value="due">Reduce amount due</option><option value="cash">Cash refund</option><option value="credit">Customer credit</option><option value="old-metal">Cash and/or return old metal</option></select></div><div class="field return-reason-field"><label>Reason (optional)</label><input id="returnReason" type="text" placeholder="e.g. Size issue"></div></div><div id="returnOldMetalPanel" class="return-metal-panel"><div class="field"><label>Original exchange metal</label><select id="returnOldMetal"></select></div><div class="field"><label>Return wt. (g)</label><input id="returnOldMetalWeight" type="number" min="0" step="0.001" value="0"></div><div class="field"><label>Cash to return (₹) · auto</label><input id="returnCashRefund" type="number" min="0" step="0.01" value="0" readonly></div><div class="field"><label>Metal return value</label><div id="returnOldMetalValue" class="return-metal-value">₹0.00</div></div></div><div class="btn-row" style="margin-top:18px;"><button class="btn btn-gold" id="saveReturnInvoice">Save return</button><button class="btn btn-ghost" id="cancelReturnInvoice">Cancel</button></div></div>';
  document.body.appendChild(returnModal);
  let activeReturnRecord = null;
  let activeReturnIndex = null;
  const returnableItems = record => (record.soldItems || []).map(item => {
    const returned = (record.returns || []).reduce((sum, returnEntry) => sum + (returnEntry.items || []).filter(returnItem => returnItem.lineId === item.lineId).reduce((itemSum, returnItem) => itemSum + (Number(returnItem.net) || 0), 0), 0);
    return Object.assign({}, item, { remainingNet: Math.max((Number(item.net) || 0) - returned, 0) });
  }).filter(item => item.remainingNet > 0.000001);
  const returnableExchanges = record => (Array.isArray(record.exchanges) ? record.exchanges : record.exchange ? [record.exchange] : []).map((exchange, exchangeIndex) => {
    const returned = (record.returns || []).reduce((sum, returnEntry) => sum + (returnEntry.oldMetal && Number(returnEntry.oldMetal.exchangeIndex) === exchangeIndex ? (Number(returnEntry.oldMetal.weight) || 0) : 0), 0);
    return Object.assign({}, exchange, { exchangeIndex, remainingWeight: Math.max((Number(exchange.weight) || 0) - returned, 0) });
  }).filter(exchange => ['gold', 'silver'].includes(String(exchange.metal || '').toLowerCase()) && exchange.remainingWeight > 0.000001);
  const selectedReturnExchange = () => {
    if (!activeReturnRecord) return null;
    const exchangeIndex = Number(document.getElementById('returnOldMetal').value);
    return returnableExchanges(activeReturnRecord).find(exchange => exchange.exchangeIndex === exchangeIndex) || null;
  };
  const updateOldMetalReturn = () => {
    const exchange = selectedReturnExchange();
    const input = document.getElementById('returnOldMetalWeight');
    const value = exchange ? Math.max(Number(input.value) || 0, 0) * (Number(exchange.rate) || 0) : 0;
    input.max = exchange ? exchange.remainingWeight : 0;
    document.getElementById('returnOldMetalValue').textContent = money(value);
    if (activeReturnRecord && document.getElementById('returnMethod').value === 'old-metal') {
      const returnAmount = calculateReturnAmount(activeReturnRecord);
      document.getElementById('returnCashRefund').value = Math.max(returnAmount - value, 0).toFixed(2);
    }
  };
  const updateReturnMethod = () => {
    const isOldMetal = document.getElementById('returnMethod').value === 'old-metal';
    document.getElementById('returnOldMetalPanel').classList.toggle('visible', isOldMetal);
    if (isOldMetal) updateOldMetalReturn();
  };
  const calculateReturnAmount = record => {
    const items = returnableItems(record);
    const originalBase = (record.soldItems || []).reduce((sum, item) => sum + (Number(item.net) || 0) * (record.weightMode === 'line-total' ? 1 : (Number(item.pcs) || 1)) * (Number(item.rate) || 0) * (1 + (Number(item.making) || 0) / 100), 0);
    const returnedBase = items.reduce((sum, item, index) => {
      const input = document.querySelector('[data-return-index="' + index + '"]');
      return sum + (Number(input && input.value) || 0) * (Number(item.rate) || 0) * (1 + (Number(item.making) || 0) / 100);
    }, 0);
    return originalBase > 0 ? returnedBase / originalBase * amount(record.total) : 0;
  };
  const updateReturnAmount = () => {
    if (!activeReturnRecord) return;
    document.getElementById('returnAmount').textContent = money(calculateReturnAmount(activeReturnRecord));
    if (document.getElementById('returnMethod').value === 'old-metal') updateOldMetalReturn();
  };
  const openReturnModal = (record, index) => {
    if (!Array.isArray(record.soldItems) || !record.soldItems.length) {
      alert('This older invoice does not have the stock-line details needed for a safe return. Returns are available for invoices created after this update.');
      return;
    }
    const items = returnableItems(record);
    if (!items.length) { alert('All stock-backed items on this invoice have already been returned.'); return; }
    activeReturnRecord = record;
    activeReturnIndex = index;
    document.getElementById('returnInvoiceLabel').textContent = 'Invoice ' + record.number + ' · enter only the net weight being returned.';
    document.getElementById('returnReason').value = '';
    document.getElementById('returnMethod').value = 'due';
    const exchanges = returnableExchanges(record);
    document.getElementById('returnOldMetal').innerHTML = exchanges.length ? exchanges.map(exchange => '<option value="' + exchange.exchangeIndex + '">' + safe(String(exchange.metal).replace(/^./, character => character.toUpperCase())) + ' · ' + exchange.remainingWeight.toFixed(3) + ' g available · ₹' + (Number(exchange.rate) || 0).toFixed(2) + '/g</option>').join('') : '<option value="">No returnable exchanged metal</option>';
    document.getElementById('returnOldMetalWeight').value = '0';
    document.getElementById('returnCashRefund').value = '0';
    document.getElementById('returnItems').innerHTML = items.map((item, itemIndex) => '<div class="return-item"><div><div class="return-item-title">' + safe(item.name || 'Stock item') + '</div><div class="return-item-meta">Available to return: ' + item.remainingNet.toFixed(3) + ' g · Original rate ₹' + (Number(item.rate) || 0).toFixed(2) + '/g</div></div><div class="field" style="min-width:140px;"><label>Return wt. (g)</label><input type="number" min="0" max="' + item.remainingNet + '" step="0.001" value="0" data-return-index="' + itemIndex + '"></div></div>').join('');
    updateReturnMethod();
    updateReturnAmount();
    returnModal.classList.add('open');
  };
  const closeReturnModal = () => {
    returnModal.classList.remove('open');
    activeReturnRecord = null;
    activeReturnIndex = null;
  };
  document.getElementById('closeReturnInvoice').addEventListener('click', closeReturnModal);
  document.getElementById('cancelReturnInvoice').addEventListener('click', closeReturnModal);
  document.getElementById('returnItems').addEventListener('input', updateReturnAmount);
  document.getElementById('returnMethod').addEventListener('change', updateReturnMethod);
  document.getElementById('returnOldMetal').addEventListener('change', updateOldMetalReturn);
  document.getElementById('returnOldMetalWeight').addEventListener('input', updateOldMetalReturn);
  document.getElementById('saveReturnInvoice').addEventListener('click', async () => {
    if (!activeReturnRecord || activeReturnIndex === null) return;
    const records = await getRecords();
    const record = records[activeReturnIndex];
    if (!record) { closeReturnModal(); return; }
    const items = returnableItems(record);
    const returnedItems = [];
    for (let index = 0; index < items.length; index += 1) {
      const input = document.querySelector('[data-return-index="' + index + '"]');
      const returnNet = Number(input && input.value) || 0;
      if (returnNet < 0 || returnNet > items[index].remainingNet + 0.000001) {
        alert('Each return weight must be between 0 and its available return weight.');
        return;
      }
      if (returnNet > 0) {
        const originalNet = Number(items[index].net) || 0;
        returnedItems.push(Object.assign({}, items[index], { returnedNet: returnNet, returnedGross: originalNet > 0 ? (Number(items[index].gross) || 0) * returnNet / originalNet : returnNet }));
      }
    }
    if (!returnedItems.length) { alert('Enter a return weight for at least one item.'); return; }
    const returnAmount = calculateReturnAmount(record);
    const method = document.getElementById('returnMethod').value;
    const paid = Number(record.paid) || 0;
    const due = Number(record.due) || 0;
    let oldMetal = null;
    let cashRefund = 0;
    if (method === 'old-metal') {
      const exchange = selectedReturnExchange();
      const weight = Number(document.getElementById('returnOldMetalWeight').value) || 0;
      cashRefund = Math.max(Number(document.getElementById('returnCashRefund').value) || 0, 0);
      if (weight > 0) {
        if (!exchange || weight > exchange.remainingWeight + 0.000001) {
          alert('Choose an original exchange entry and enter a valid old-metal return weight.');
          return;
        }
        const oldMetalEntries = await getOldGold();
        const metal = String(exchange.metal).toLowerCase();
        const available = oldMetalEntries.filter(entry => String(entry.metal || '').toLowerCase() === metal).reduce((total, entry) => total + (Number(entry.weight) || 0), 0);
        if (weight > available + 0.000001) {
          alert('Only ' + available.toFixed(3) + ' g of old ' + metal + ' is currently available to return.');
          return;
        }
        oldMetal = { exchangeIndex: exchange.exchangeIndex, metal, weight, rate: Number(exchange.rate) || 0, value: weight * (Number(exchange.rate) || 0) };
      }
      const refundTotal = cashRefund + (oldMetal ? oldMetal.value : 0);
      if (!(refundTotal > 0) || Math.abs(refundTotal - returnAmount) > 0.01) {
        alert('Cash plus old-metal value must exactly match the return / credit-note value of ' + money(returnAmount) + '.');
        return;
      }
      if (cashRefund > paid + 0.001) {
        alert('Cash to return cannot exceed the recorded cash payment of ' + money(paid) + '.');
        return;
      }
    }
    if (method === 'cash' && returnAmount > paid + 0.001) {
      alert('A cash refund cannot exceed the amount paid (' + money(paid) + '). Choose customer credit or reduce the due amount.');
      return;
    }
    if (method === 'due' && returnAmount > due + 0.001) {
      alert('This return is larger than the outstanding due (' + money(due) + '). Choose customer credit or cash refund for the balance.');
      return;
    }
    const stockResult = await window.storage.get('stock-list');
    const stockList = stockResult ? JSON.parse(stockResult.value || '[]') : [];
    for (const item of returnedItems) {
      if (!stockList.find(stock => String(stock.id) === String(item.stockId))) {
        alert('The original stock item “' + item.name + '” no longer exists. The return was not saved.');
        return;
      }
    }
    returnedItems.forEach(item => {
      const stock = stockList.find(stockItem => String(stockItem.id) === String(item.stockId));
      stock.net = (Number(stock.net) || 0) + item.returnedNet;
      stock.gross = (Number(stock.gross) || 0) + item.returnedGross;
    });
    record.returns = Array.isArray(record.returns) ? record.returns : [];
    const savedAt = new Date().toISOString();
    const returnEntry = {
      noteNumber: record.number + '-R' + String(record.returns.length + 1).padStart(2, '0'),
      items: returnedItems.map(item => ({ lineId: item.lineId, stockId: item.stockId, name: item.name, net: item.returnedNet, gross: item.returnedGross })),
      amount: returnAmount,
      method,
      oldMetal,
      cashRefund: method === 'old-metal' ? cashRefund : 0,
      reason: document.getElementById('returnReason').value.trim(),
      savedAt
    };
    record.returns.unshift(returnEntry);
    record.returnTotal = (Number(record.returnTotal) || 0) + returnAmount;
    if (method === 'cash') record.paid = Math.max(paid - returnAmount, 0);
    if (method === 'old-metal') record.paid = Math.max(paid - cashRefund, 0);
    if (method === 'credit') record.customerCredit = (Number(record.customerCredit) || 0) + returnAmount;
    record.due = Math.max(recordNetTotal(record) - (Number(record.paid) || 0), 0);
    await originalStorageSet('stock-list', JSON.stringify(stockList));
    await originalStorageSet('invoice-records', JSON.stringify(records));
    if (oldMetal) {
      await addOldGold({ sourceId: record.number + ':return-metal:' + returnEntry.noteNumber, metal: oldMetal.metal, source: 'Invoice return - old metal given back', invoice: record.number, customer: record.customer, date: new Date(savedAt).toLocaleDateString('en-GB'), weight: -oldMetal.weight, rate: oldMetal.rate, value: -oldMetal.value, receivedAt: savedAt });
    }
    closeReturnModal();
    await renderRecords();
  });
  document.getElementById('printRegeneratedInvoice').addEventListener('click', () => {
    const paper = document.querySelector('#regeneratedInvoiceContent #invoicePaper');
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Please allow pop-ups to print the invoice.'); return; }
    printWindow.document.write('<!doctype html><html><head><title>Invoice ' + safe(regeneratedModal.dataset.invoiceNumber) + '</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Jost:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">' + document.querySelector('style').outerHTML + '<style>body{background:#fff;padding:24px}#invoicePaper{max-width:800px;margin:auto}</style></head><body>' + paper.outerHTML + '</body></html>');
    printWindow.document.close();
  });
  document.getElementById('downloadRegeneratedInvoice').addEventListener('click', async () => {
    const paper = document.querySelector('#regeneratedInvoiceContent #invoicePaper');
    try {
      const canvas = await html2canvas(paper, { scale: 2, backgroundColor: '#FAF5E7' });
      const pdf = new window.jspdf.jsPDF('p', 'pt', 'a4');
      const width = pdf.internal.pageSize.getWidth() - 40;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 20, 20, width, canvas.height * (width / canvas.width));
      pdf.save('Invoice-' + regeneratedModal.dataset.invoiceNumber + '.pdf');
    } catch (error) { alert('Could not generate the PDF.'); }
  });
