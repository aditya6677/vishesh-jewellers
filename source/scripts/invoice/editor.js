  const editInvoiceModal = document.createElement('div');
  editInvoiceModal.id = 'editInvoiceModal';
  editInvoiceModal.className = 'modal-backdrop';
  editInvoiceModal.innerHTML = '<div class="modal" style="max-width:980px; max-height:92vh; overflow:auto;"><div class="toolbar"><h3 style="margin:0;">Edit Invoice</h3><button class="btn btn-ghost btn-sm" id="closeEditInvoice">Close</button></div><p class="void-modal-note">Update this active invoice completely. Weights are totals for the line; PCS only affects stock quantity. Saving recalculates totals and safely reconciles stock and exchanged metal.</p><div class="form-grid"><div class="field"><label>Invoice date *</label><input id="editInvoiceDate" type="date"></div><div class="field"><label>Customer name *</label><input id="editInvoiceCustomer" type="text"></div><div class="field"><label>Mobile number</label><input id="editInvoiceMobile" type="tel"></div><div class="field"><label>Address</label><input id="editInvoiceAddress" type="text"></div></div><div class="field" style="margin-top:14px;"><label>Terms &amp; conditions</label><textarea id="editInvoiceTerms" style="min-height:70px;"></textarea></div><div class="toolbar" style="margin-top:20px;"><h4 style="margin:0;">Items</h4><button class="btn btn-ghost btn-sm" id="addEditItem" type="button">+ Add item</button></div><div class="items-table-wrap"><table class="itable"><thead><tr><th>From stock</th><th>Item</th><th>Purity</th><th>Gross Wt (g) · total</th><th>Net Wt (g) · total</th><th>Pcs</th><th>Rate (₹/g)</th><th>Making %</th><th>Amount</th><th></th></tr></thead><tbody id="editInvoiceItems"></tbody></table></div><div class="toolbar" style="margin-top:20px;"><h4 style="margin:0;">Gold / Silver Exchange</h4><button class="btn btn-ghost btn-sm" id="addEditExchange" type="button">+ Add exchange item</button></div><div id="editInvoiceExchangeRows" class="exchange-rows"></div><div class="form-grid" style="margin-top:18px;"><div class="field"><label>Manual discount (₹)</label><input id="editInvoiceDiscount" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>GST rate</label><select id="editInvoiceGst"><option value="3">3% (CGST + SGST)</option><option value="0">0% (Exempt)</option></select></div><div class="field"><label>Amount paid at invoice (₹)</label><input id="editInvoicePaid" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Revised total</label><div class="payment-balance" id="editInvoiceTotal">₹0.00</div></div></div><div class="record-info-grid" style="margin:14px 0 0;"><div class="record-info"><b>Items subtotal</b><span id="editInvoiceSubtotal">₹0.00</span></div><div class="record-info"><b>Exchange credit</b><span id="editInvoiceExchange">₹0.00</span></div><div class="record-info"><b>Amount due</b><span class="due-amount" id="editInvoiceDue">₹0.00</span></div></div><div class="btn-row" style="margin-top:20px;"><button class="btn btn-gold" id="saveInvoiceEdit">Save Revised Invoice</button><button class="btn btn-ghost" id="cancelInvoiceEdit">Cancel</button></div></div>';
  document.body.appendChild(editInvoiceModal);
  document.querySelector('#editInvoiceGst option[value="3"]').textContent = 'GST Invoice — 3%';
  document.querySelector('#editInvoiceGst option[value="0"]').textContent = 'Non-GST Invoice — No GST charged';
  let activeEditInvoiceIndex = null;
  let editInvoiceState = { items: [], exchanges: [], stock: [], record: null };
  const closeEditInvoiceModal = () => { editInvoiceModal.classList.remove('open'); activeEditInvoiceIndex = null; };
  const editMoney = value => money(Number(value) || 0);
  const editItemAmount = item => (Number(item.net) || 0) * (Number(item.rate) || 0) * (1 + (Number(item.making) || 0) / 100);
  const editInitialPaidFor = record => {
    if (Number.isFinite(Number(record.initialPaid))) return Number(record.initialPaid);
    const payments = Array.isArray(record.payments) ? record.payments : [];
    const initialPayment = payments.find(payment => payment.initialPayment) || payments.find(payment => payment.settledAt && record.savedAt && Math.abs(new Date(payment.settledAt) - new Date(record.savedAt)) < 60_000);
    return initialPayment ? Number(initialPayment.amount) || 0 : Math.max((Number(record.paid) || 0) - payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0), 0);
  };
  const editTotals = () => {
    const subtotal = editInvoiceState.items.reduce((sum, item) => sum + editItemAmount(item), 0);
    const exchange = editInvoiceState.exchanges.reduce((sum, item) => sum + (Number(item.weight) || 0) * (Number(item.rate) || 0), 0);
    const discount = Math.max(Number(document.getElementById('editInvoiceDiscount').value) || 0, 0);
    const gstRate = Math.max(Number(document.getElementById('editInvoiceGst').value) || 0, 0);
    // Keep the editor consistent with invoice creation: tax applies to the
    // full item value, while exchange and discount reduce the final payable.
    const tax = subtotal * gstRate / 100;
    const total = Math.round(Math.max(subtotal + tax - exchange - discount, 0));
    const settlementPaid = Math.max((Number(editInvoiceState.record.paid) || 0) - editInitialPaidFor(editInvoiceState.record), 0);
    const invoicePaid = Math.max(Number(document.getElementById('editInvoicePaid').value) || 0, 0);
    const due = Math.max(total - invoicePaid - settlementPaid, 0);
    document.getElementById('editInvoiceSubtotal').textContent = editMoney(subtotal);
    document.getElementById('editInvoiceExchange').textContent = editMoney(exchange);
    document.getElementById('editInvoiceTotal').textContent = editMoney(total);
    document.getElementById('editInvoiceDue').textContent = editMoney(due);
    return { subtotal, exchange, discount, gstRate, tax, total, invoicePaid, settlementPaid, due };
  };
  const renderEditItems = () => {
    const body = document.getElementById('editInvoiceItems');
    body.innerHTML = editInvoiceState.items.map((item, index) => {
      const options = ['<option value="">— select stock item —</option>'].concat(editInvoiceState.stock.filter(stock => (Number(stock.qty) > 0 && (Number(stock.net) || Number(stock.gross) || 0) > 0) || stock.id === item.stockId).map(stock => '<option value="' + safe(stock.id) + '" ' + (stock.id === item.stockId ? 'selected' : '') + '>' + safe(stock.item + ' · ' + stock.purity + ' · ' + (Number(stock.qty) || 0) + ' pcs · ' + (Number(stock.net) || 0).toFixed(3) + ' g') + '</option>')).join('');
      return '<tr data-edit-item="' + index + '"><td><select class="edit-stock">' + options + '</select></td><td>' + safe(item.name || '—') + '</td><td>' + safe(item.purity || '—') + '</td><td><input class="edit-gross" type="number" min="0" step="0.001" value="' + (Number(item.gross) || 0) + '"></td><td><input class="edit-net" type="number" min="0" step="0.001" value="' + (Number(item.net) || 0) + '"></td><td><input class="edit-pcs" type="number" min="1" step="1" value="' + (Number(item.pcs) || 1) + '"></td><td><input class="edit-rate" type="number" min="0" step="0.01" value="' + (Number(item.rate) || 0) + '"></td><td><input class="edit-making" type="number" min="0" step="0.01" value="' + (Number(item.making) || 0) + '"></td><td class="edit-item-total">' + editMoney(editItemAmount(item)) + '</td><td><button class="btn btn-ghost btn-sm edit-item-remove" type="button">×</button></td></tr>';
    }).join('') || '<tr><td colspan="9" style="text-align:center; padding:16px;">Add at least one stock item.</td></tr>';
  };
  const renderEditExchanges = () => {
    const container = document.getElementById('editInvoiceExchangeRows');
    container.innerHTML = editInvoiceState.exchanges.map((entry, index) => '<div class="exchange-row" data-edit-exchange="' + index + '"><div class="field"><label>Metal *</label><select class="edit-exchange-metal"><option value="gold" ' + (entry.metal === 'gold' ? 'selected' : '') + '>Gold</option><option value="silver" ' + (entry.metal === 'silver' ? 'selected' : '') + '>Silver</option></select></div><div class="field"><label>Weight (g) *</label><input class="edit-exchange-weight" type="number" min="0" step="0.001" value="' + (Number(entry.weight) || 0) + '"></div><div class="field"><label>Rate / gram (₹) *</label><input class="edit-exchange-rate" type="number" min="0" step="0.01" value="' + (Number(entry.rate) || 0) + '"></div><div class="field"><label>Value</label><div class="exchange-row-value">' + editMoney((Number(entry.weight) || 0) * (Number(entry.rate) || 0)) + '</div></div><button class="btn btn-ghost btn-sm edit-exchange-remove" type="button">×</button></div>').join('') || '<p class="sub" style="margin:0;">No exchange items added.</p>';
  };
  const refreshEditInvoice = () => { renderEditItems(); renderEditExchanges(); editTotals(); };
  const openEditInvoiceModal = async (record, index) => {
    activeEditInvoiceIndex = index;
    const stockResult = await window.storage.get('stock-list');
    editInvoiceState.stock = stockResult ? JSON.parse(stockResult.value) : [];
    editInvoiceState.record = record;
    const exchanges = Array.isArray(record.exchanges) ? record.exchanges : record.exchange ? [record.exchange] : [];
    const totalExchange = exchanges.reduce((sum, entry) => sum + (Number(entry.value) || (Number(entry.weight) || 0) * (Number(entry.rate) || 0)), 0);
    editInvoiceState.items = ((record.status === 'pending' ? record.orderItems : record.soldItems) || []).map((item, itemIndex) => {
      const pcs = Number(item.pcs) || 1;
      const multiplier = record.weightMode === 'line-total' ? 1 : pcs;
      return Object.assign({ lineId: item.lineId || ('edit-' + itemIndex), hsn: item.hsn || '' }, item, { gross: (Number(item.gross) || 0) * multiplier, net: (Number(item.net) || 0) * multiplier });
    });
    editInvoiceState.exchanges = exchanges.map(entry => ({ metal: entry.metal === 'silver' ? 'silver' : 'gold', weight: Number(entry.weight) || 0, rate: Number(entry.rate) || 0 }));
    document.getElementById('editInvoiceDate').value = record.invoiceDate || (record.savedAt ? record.savedAt.slice(0, 10) : '');
    document.getElementById('editInvoiceCustomer').value = record.customer || '';
    document.getElementById('editInvoiceMobile').value = record.mobile || '';
    document.getElementById('editInvoiceAddress').value = record.address || '';
    const markupPreview = document.createElement('div');
    markupPreview.innerHTML = record.invoiceMarkup || '';
    document.getElementById('editInvoiceTerms').value = record.terms || (markupPreview.querySelector('#p-terms') ? markupPreview.querySelector('#p-terms').textContent : '');
    document.getElementById('editInvoiceDiscount').value = Math.max(Number.isFinite(Number(record.manualDiscount)) ? Number(record.manualDiscount) : amount(record.discount) - totalExchange, 0).toFixed(2);
    document.getElementById('editInvoiceGst').value = String(record.gstRate != null ? Number(record.gstRate) : (amount(record.tax) > 0 ? 3 : 0));
    document.getElementById('editInvoicePaid').value = editInitialPaidFor(record).toFixed(2);
    refreshEditInvoice();
    editInvoiceModal.classList.add('open');
  };
  document.getElementById('closeEditInvoice').addEventListener('click', closeEditInvoiceModal);
  document.getElementById('cancelInvoiceEdit').addEventListener('click', closeEditInvoiceModal);
  document.getElementById('addEditItem').addEventListener('click', () => { editInvoiceState.items.push({ lineId: 'edit-' + Date.now(), stockId: '', name: '', purity: '', gross: 0, net: 0, pcs: 1, rate: 0, making: 0 }); refreshEditInvoice(); });
  document.getElementById('addEditExchange').addEventListener('click', () => { editInvoiceState.exchanges.push({ metal: 'gold', weight: 0, rate: 0, required: true }); refreshEditInvoice(); });
  document.getElementById('editInvoiceItems').addEventListener('change', event => {
    const row = event.target.closest('[data-edit-item]'); if (!row) return;
    const item = editInvoiceState.items[Number(row.dataset.editItem)];
    if (event.target.classList.contains('edit-stock')) {
      const stock = editInvoiceState.stock.find(entry => entry.id === event.target.value);
      item.stockId = stock ? stock.id : '';
      item.name = stock ? stock.item : '';
      item.purity = stock ? stock.purity : '';
      refreshEditInvoice();
    }
  });
  document.getElementById('editInvoiceItems').addEventListener('input', event => {
    const row = event.target.closest('[data-edit-item]'); if (!row) return;
    const item = editInvoiceState.items[Number(row.dataset.editItem)];
    const property = event.target.classList.contains('edit-gross') ? 'gross' : event.target.classList.contains('edit-net') ? 'net' : event.target.classList.contains('edit-pcs') ? 'pcs' : event.target.classList.contains('edit-rate') ? 'rate' : event.target.classList.contains('edit-making') ? 'making' : null;
    if (!property) return;
    item[property] = property === 'pcs' ? Math.max(parseInt(event.target.value, 10) || 1, 1) : Math.max(Number(event.target.value) || 0, 0);
    row.querySelector('.edit-item-total').textContent = editMoney(editItemAmount(item));
    editTotals();
  });
  document.getElementById('editInvoiceItems').addEventListener('click', event => {
    const button = event.target.closest('.edit-item-remove'); if (!button) return;
    editInvoiceState.items.splice(Number(button.closest('[data-edit-item]').dataset.editItem), 1); refreshEditInvoice();
  });
  document.getElementById('editInvoiceExchangeRows').addEventListener('input', event => {
    const row = event.target.closest('[data-edit-exchange]'); if (!row) return;
    const entry = editInvoiceState.exchanges[Number(row.dataset.editExchange)];
    if (event.target.classList.contains('edit-exchange-weight')) entry.weight = Math.max(Number(event.target.value) || 0, 0);
    if (event.target.classList.contains('edit-exchange-rate')) entry.rate = Math.max(Number(event.target.value) || 0, 0);
    row.querySelector('.exchange-row-value').textContent = editMoney(entry.weight * entry.rate); editTotals();
  });
  document.getElementById('editInvoiceExchangeRows').addEventListener('change', event => {
    const row = event.target.closest('[data-edit-exchange]'); if (!row) return;
    if (event.target.classList.contains('edit-exchange-metal')) editInvoiceState.exchanges[Number(row.dataset.editExchange)].metal = event.target.value;
  });
  document.getElementById('editInvoiceExchangeRows').addEventListener('click', event => {
    const button = event.target.closest('.edit-exchange-remove'); if (!button) return;
    editInvoiceState.exchanges.splice(Number(button.closest('[data-edit-exchange]').dataset.editExchange), 1); refreshEditInvoice();
  });
  ['editInvoiceDiscount', 'editInvoiceGst', 'editInvoicePaid'].forEach(id => document.getElementById(id).addEventListener('input', editTotals));
  document.getElementById('saveInvoiceEdit').addEventListener('click', async () => {
    const records = await getRecords();
    const record = records[activeEditInvoiceIndex];
    if (!record || record.status === 'voided') { closeEditInvoiceModal(); return; }
    const invoiceDate = document.getElementById('editInvoiceDate').value;
    const customer = document.getElementById('editInvoiceCustomer').value.trim();
    if (!invoiceDate) { alert('Invoice date is required.'); document.getElementById('editInvoiceDate').focus(); return; }
    if (!customer) { alert('Customer name is required.'); document.getElementById('editInvoiceCustomer').focus(); return; }
    const mobile = document.getElementById('editInvoiceMobile').value.trim();
    const address = document.getElementById('editInvoiceAddress').value.trim();
    const terms = document.getElementById('editInvoiceTerms').value.trim();
    const items = editInvoiceState.items.filter(item => item.stockId);
    if (!items.length || items.length !== editInvoiceState.items.length || items.some(item => !(Number(item.gross) > 0) || !(Number(item.net) > 0) || !(Number(item.rate) > 0) || !Number.isInteger(Number(item.pcs)) || Number(item.pcs) < 1)) { alert('Select a stock item and enter its quantity, gross weight, net weight, and rate for every item row.'); return; }
    const incompleteExchange = editInvoiceState.exchanges.find(entry => (entry.required && (!(Number(entry.weight) > 0) || !(Number(entry.rate) > 0))) || ((Number(entry.weight) > 0 || Number(entry.rate) > 0) && (!(Number(entry.weight) > 0) || !(Number(entry.rate) > 0))));
    if (incompleteExchange) { alert('Complete both weight and rate for each exchange item, or remove the empty row.'); return; }
    const totals = editTotals();
    const displayDate = new Date(invoiceDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const stockResult = await window.storage.get('stock-list');
    const stockList = stockResult ? JSON.parse(stockResult.value) : [];
    (record.soldItems || []).forEach(item => {
      let stock = stockList.find(entry => entry.id === item.stockId);
      if (!stock) { stock = { id: item.stockId, item: item.name || 'Restored item', purity: item.purity || '', qty: 1, gross: 0, net: 0, added: 'Restored from ' + record.number }; stockList.push(stock); }
      stock.qty = (Number(stock.qty) || 0) + (Number(item.pcs) || 1);
      const weightMultiplier = record.weightMode === 'line-total' ? 1 : (Number(item.pcs) || 1);
      stock.gross = (Number(stock.gross) || 0) + (Number(item.gross) || 0) * weightMultiplier;
      stock.net = (Number(stock.net) || 0) + (Number(item.net) || 0) * weightMultiplier;
    });
    const requested = new Map();
    items.forEach(item => {
      const requestedItem = requested.get(item.stockId) || { gross: 0, net: 0, pcs: 0, name: item.name };
      const pcs = Number(item.pcs) || 1;
      requestedItem.pcs += pcs; requestedItem.gross += Number(item.gross) || 0; requestedItem.net += Number(item.net) || 0; requested.set(item.stockId, requestedItem);
    });
    for (const [stockId, requestedItem] of requested) {
      const stock = stockList.find(entry => entry.id === stockId);
      if (!stock || requestedItem.pcs > (Number(stock.qty) || 0) || requestedItem.gross > (Number(stock.gross) || 0) + 0.0001 || requestedItem.net > (Number(stock.net) || 0) + 0.0001) { alert('Not enough remaining stock quantity or weight for "' + requestedItem.name + '".'); return; }
    }
    requested.forEach((requestedItem, stockId) => { const stock = stockList.find(entry => entry.id === stockId); stock.qty = Math.max((Number(stock.qty) || 0) - requestedItem.pcs, 0); stock.gross = Math.max((Number(stock.gross) || 0) - requestedItem.gross, 0); stock.net = Math.max((Number(stock.net) || 0) - requestedItem.net, 0); });
    const exchanges = editInvoiceState.exchanges.filter(entry => Number(entry.weight) > 0).map(entry => Object.assign({}, entry, { value: Number(entry.weight) * Number(entry.rate) }));
    const previousInitialPaid = editInitialPaidFor(record);
    record.invoiceDate = invoiceDate;
    record.date = displayDate;
    record.customer = customer;
    record.mobile = mobile;
    record.address = address;
    record.terms = terms;
    record.weightMode = 'line-total';
    record.soldItems = items.map((item, itemIndex) => Object.assign({}, item, { lineId: item.lineId || ('edit-' + itemIndex) }));
    if (record.status === 'pending') {
      record.status = 'completed';
      record.deliveredAt = new Date().toISOString();
    }
    record.items = items.map(item => item.name).join(', ');
    record.exchanges = exchanges;
    record.manualDiscount = totals.discount;
    record.gstRate = totals.gstRate;
    record.subtotal = editMoney(totals.subtotal);
    record.discount = editMoney(totals.exchange + totals.discount);
    record.tax = editMoney(totals.tax);
    record.total = editMoney(totals.total);
    record.initialPaid = totals.invoicePaid;
    record.paid = totals.invoicePaid + Math.max((Number(record.paid) || 0) - previousInitialPaid, 0);
    record.due = Math.max(totals.total - record.paid, 0);
    record.payments = Array.isArray(record.payments) ? record.payments : [];
    const savedInitialPayment = record.payments.find(payment => payment.initialPayment) || record.payments.find(payment => payment.settledAt && record.savedAt && Math.abs(new Date(payment.settledAt) - new Date(record.savedAt)) < 60_000);
    if (savedInitialPayment) { savedInitialPayment.amount = totals.invoicePaid; savedInitialPayment.initialPayment = true; }
    else if (totals.invoicePaid > 0) record.payments.push({ method: 'amount', amount: totals.invoicePaid, initialPayment: true, settledAt: record.savedAt || new Date().toISOString() });
    const preview = document.createElement('div');
    preview.innerHTML = record.invoiceMarkup || '<div id="invoicePaper"><tbody id="p-items-body"></tbody><div id="p-totals"></div></div>';
    const paper = preview.querySelector('#invoicePaper');
    if (paper) {
      const setText = (selector, value) => { const element = paper.querySelector(selector); if (element) element.textContent = value; };
      setText('#p-cust-name', customer); setText('#p-cust-address', [address, mobile ? 'Mob: ' + mobile : ''].filter(Boolean).join(' · ')); setText('#p-date', displayDate);
      setText('#p-terms', terms);
      const body = paper.querySelector('#p-items-body');
      if (body) body.innerHTML = items.map((item, itemIndex) => { const pcs = Number(item.pcs) || 1; return '<tr><td>' + (itemIndex + 1) + '</td><td>' + safe(item.name) + '</td><td class="num">' + safe(item.hsn || '') + '</td><td>' + safe(item.purity) + '</td><td class="num">' + (Number(item.gross) || 0).toFixed(3) + '</td><td class="num">' + (Number(item.net) || 0).toFixed(3) + '</td><td class="num">' + pcs + '</td><td class="num">' + (Number(item.rate) || 0).toFixed(2) + '</td><td class="num">' + (Number(item.making) || 0).toFixed(2) + '%</td><td class="num">' + editItemAmount(item).toFixed(2) + '</td></tr>'; }).join('');
      const totalsPanel = paper.querySelector('#p-totals');
      if (totalsPanel) totalsPanel.innerHTML = '<div class="tl"><span>Total</span><b>' + editMoney(totals.subtotal) + '</b></div><div class="tl"><span>Exchange / Discount</span><b>' + editMoney(totals.exchange + totals.discount) + '</b></div><div class="tl"><span>CGST ' + (totals.gstRate / 2) + '%</span><b>' + editMoney(totals.tax / 2) + '</b></div><div class="tl"><span>SGST ' + (totals.gstRate / 2) + '%</span><b>' + editMoney(totals.tax / 2) + '</b></div><div class="gt"><span>Grand Total</span><b>' + editMoney(totals.total) + '</b></div>';
      const words = paper.querySelector('#p-words'); if (words && typeof numToWords === 'function') words.textContent = totals.total > 0 ? 'Rs. ' + numToWords(totals.total) + ' Only' : '';
      setText('#p-gstin', totals.gstRate === 0 ? 'NON-GST INVOICE' : 'GSTIN: ' + (record.gstin || '—'));
      if (totals.gstRate === 0 && totalsPanel) {
        totalsPanel.querySelectorAll('.tl').forEach(line => {
          if (/^(CGST|SGST)/.test(line.textContent.trim())) line.remove();
        });
      }
      record.invoiceMarkup = paper.outerHTML;
    }
    const oldMetal = await getOldGold();
    const remainingOldMetal = oldMetal.filter(entry => !String(entry.sourceId || '').startsWith(record.number + ':exchange:'));
    exchanges.forEach((entry, exchangeIndex) => remainingOldMetal.unshift({ sourceId: record.number + ':exchange:' + entry.metal + ':' + exchangeIndex, metal: entry.metal, source: 'Invoice exchange', invoice: record.number, customer: customer, date: displayDate, weight: entry.weight, rate: entry.rate, value: entry.value, receivedAt: record.savedAt }));
    await originalStorageSet('stock-list', JSON.stringify(stockList));
    await originalStorageSet('old-gold-records', JSON.stringify(remainingOldMetal));
    await originalStorageSet('invoice-records', JSON.stringify(records));
    closeEditInvoiceModal();
    await renderRecords();
  });
