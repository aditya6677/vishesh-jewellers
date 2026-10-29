  const invoiceItemFields = ['name', 'purity', 'gross', 'net', 'pcs', 'rate', 'making'];
  const invoiceRateRequests = new Map();
  let invoiceRateRequestId = 0;
  let invoiceItemsSaving = false;
  window.addEventListener('vj:invoice-save-start', () => { invoiceItemsSaving = true; });
  window.addEventListener('vj:invoice-save-end', () => { invoiceItemsSaving = false; });
  const refreshInvoiceItems = () => { renderRowsTable(); renderPreview(); };
  window.addEventListener('vj:stock-cache-merge', event => {
    for (const stock of event.detail || []) { const index = stockList.findIndex(item => String(item.id) === String(stock.id)); if (index < 0) stockList.push(stock); else stockList[index] = stock; }
    if (window.vjDatabaseMode && stockList.length > 500) { const selected = new Set(rows.map(row => String(row.stockId))); stockList = stockList.filter((stock, index) => selected.has(String(stock.id)) || index >= stockList.length - 200); }
    refreshInvoiceItems();
  });
  window.addEventListener('vj:stocks-invalidated', () => {
    if (!window.vjDatabaseMode) return;
    Promise.all(rows.filter(row => row.stockId).map(async row => {
      const response = await fetch('/api/stocks/' + encodeURIComponent(row.stockId));
      if (response.ok) { const result = await response.json(); window.dispatchEvent(new CustomEvent('vj:stock-cache-merge', { detail: [result.item] })); }
      else if (response.status === 404) { stockList = stockList.filter(stock => String(stock.id) !== String(row.stockId)); refreshInvoiceItems(); }
    })).catch(() => {});
  });
  window.vjInvoiceItems = {
    read: () => ({
      items: rows.map(row => ({ ...row, amount: rowAmount(row), available: Object.fromEntries(stockList.map(stock => [stock.id, availableQtyFor(stock, row.id)])) })),
      stock: stockList.map(stock => ({ ...stock })), pending: Boolean(window.orderMode)
    }),
    update: (id, field, value) => {
      if (invoiceItemsSaving || !invoiceItemFields.includes(field)) return;
      const row = rows.find(item => item.id === id);
      if (!row || (field === 'name' && !window.orderMode) || (field === 'purity' && row.stockId)) return;
      if (field === 'pcs') {
        let pcs = value === '' ? '' : parseInt(value) || 1;
        const stock = stockList.find(item => item.id === row.stockId);
        if (stock && pcs !== '' && pcs > availableQtyFor(stock, row.id)) {
          const available = availableQtyFor(stock, row.id);
          toast('Only ' + available + ' piece(s) of "' + stock.item + '" left in stock');
          pcs = Math.max(available, 1);
        }
        row.pcs = pcs;
      } else {
        row[field] = value;
        if (field === 'rate') invoiceRateRequests.delete(id);
        if (field === 'name' && !row.stockId) {
          const master = itemsMaster.find(item => item.name.toLowerCase() === String(value).toLowerCase());
          if (master) { row.hsn = master.hsn; row.making = master.making; row.purity = master.purity || row.purity; }
        }
      }
      refreshInvoiceItems();
    },
    commitQuantity: id => {
      if (invoiceItemsSaving) return;
      const row = rows.find(item => item.id === id);
      if (row) { row.pcs = Math.max(parseInt(row.pcs) || 1, 1); refreshInvoiceItems(); }
    },
    selectStock: async (id, stockId) => {
      if (invoiceItemsSaving) return;
      const row = rows.find(item => item.id === id);
      const stock = stockList.find(item => String(item.id) === String(stockId));
      if (!row || !stock) return;
      const available = availableQtyFor(stock, row.id);
      if (available <= 0 && row.stockId !== stock.id) { toast('Not enough remaining quantity for "' + stock.item + '"'); return; }
      row.stockId = stock.id; row.name = stock.item; row.purity = stock.purity;
      row.rate = stock.rate || ''; row.gross = ''; row.net = '';
      const master = itemsMaster.find(item => item.name.toLowerCase() === stock.item.toLowerCase());
      if (master) { row.hsn = master.hsn; row.making = master.making; }
      row.pcs = Math.min(parseInt(row.pcs) || 1, Math.max(available, 1));
      const requestId = ++invoiceRateRequestId;
      invoiceRateRequests.set(id, requestId);
      const originalRate = row.rate;
      refreshInvoiceItems();
      try {
        const rates = await getInvoiceMarketRates();
        const suggested = invoiceRateForStock(stock, rates);
        if (!invoiceItemsSaving && rows.includes(row) && invoiceRateRequests.get(id) === requestId && row.stockId === stock.id && row.rate === originalRate && suggested > 0) {
          row.rate = suggested.toFixed(2);
          refreshInvoiceItems();
        }
      } catch (_) { /* Rates are optional; the rate remains editable offline. */ }
    },
    add: () => { if (!invoiceItemsSaving) { rows.push(newRow()); refreshInvoiceItems(); } },
    remove: id => {
      if (invoiceItemsSaving) return;
      invoiceRateRequests.delete(id);
      rows = rows.filter(row => row.id !== id);
      if (!rows.length) rows.push(newRow());
      refreshInvoiceItems();
    }
  };
