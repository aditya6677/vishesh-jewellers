  // Shared by the existing editor and old-metal helpers during migration.
  const originalStorageSet = window.storage.set.bind(window.storage);
  let invoiceSaving = false;
  let invoiceSaveAttempt = null;

  const invoiceInputValue = id => document.getElementById(id).value;
  const collectInvoiceDraft = status => {
    const enteredRows = status === 'pending'
      ? rows.filter(row => String(row.name || '').trim() || row.gross !== '' || row.net !== '' || row.rate !== '')
      : rows;
    const manualDiscount = invoiceInputValue('invoice-discount');
    const exchanges = Array.from(document.querySelectorAll('#exchangeRows .exchange-row')).map(row => ({
      metal: row.querySelector('.exchange-row-metal').value,
      weight: row.querySelector('.exchange-row-weight').value,
      rate: row.querySelector('.exchange-row-rate').value,
      required: row.dataset.required === 'true'
    }));
    const exchangeCredit = getExchangeEntries().reduce((sum, entry) => sum + entry.value, 0);
    const hiddenExchange = document.getElementById('exchange-disc');
    hiddenExchange.value = (exchangeCredit + Math.max(Number(manualDiscount) || 0, 0)).toFixed(2);
    hiddenExchange.dispatchEvent(new Event('input', { bubbles: true }));
    window.vjInvoicePreview?.flush();
    return {
      number: invoiceInputValue('inv-no'), invoiceDate: invoiceInputValue('inv-date'), status,
      customer: invoiceInputValue('cust-name'), mobile: invoiceInputValue('cust-mobile'), address: invoiceInputValue('cust-address'),
      business: invoiceInputValue('biz-name'), gstin: invoiceInputValue('biz-gstin'), terms: invoiceInputValue('inv-terms'),
      items: enteredRows.map(row => ({ lineId: row.id, stockId: row.stockId || '', name: row.name || '', hsn: row.hsn || '', purity: row.purity || '', gross: row.gross, net: row.net, pcs: row.pcs, rate: row.rate, making: row.making })),
      exchanges, manualDiscount, paid: invoiceInputValue('amount-paid'), gstRate: Number(invoiceInputValue('gst-rate')) * 2,
      expectedTotal: amount(document.getElementById('mini-grand').textContent),
      invoiceMarkup: document.getElementById('invoicePaper').outerHTML
    };
  };

  const saveInvoiceThroughApi = async status => {
    if (invoiceSaving || saleCompleted) return;
    let draft;
    try {
      if (!window.vjInvoiceExchangeEntries || !document.getElementById('amount-paid')) throw new Error('The invoice form is still loading. Please try again.');
      if (document.getElementById('react-invoice-preview') && !window.vjInvoicePreview) throw new Error('The invoice preview is still loading. Please try again.');
      draft = collectInvoiceDraft(status);
    } catch (error) { showAppMessage(error.message, 'error'); return; }
    const signature = JSON.stringify(draft);
    if (!invoiceSaveAttempt || invoiceSaveAttempt.signature !== signature) invoiceSaveAttempt = { signature, requestId: crypto.randomUUID() };
    invoiceSaving = true;
    window.dispatchEvent(new Event('vj:invoice-save-start'));
    const controls = Array.from(document.querySelectorAll('#page-home input, #page-home select, #page-home textarea, #page-home button')).map(element => [element, element.disabled]);
    controls.forEach(([element]) => { element.disabled = true; });
    const statusElement = document.getElementById('saleStatus');
    statusElement.textContent = status === 'pending' ? 'Saving pending order…' : 'Saving invoice and updating stock…';
    let committed = false;
    try {
      const response = await fetch('/api/invoices', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, requestId: invoiceSaveAttempt.requestId }), signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save the invoice.');
      committed = true;
      invoiceSaveAttempt = null;
      if (result.stockScope === 'affected-only') window.dispatchEvent(new CustomEvent('vj:stock-cache-merge', { detail: result.stock }));
      else stockList = result.stock;
      invoiceCounter = result.nextCounter;
      await resetInvoiceForm(false);
      document.getElementById('invoiceType').value = 'sale';
      window.orderMode = false;
      document.getElementById('gst-rate').value = '1.5';
      updateInvoiceType();
      window.dispatchEvent(new Event('vj:invoice-reset'));
      window.dispatchEvent(new Event('vj:stocks-refresh'));
      window.dispatchEvent(new Event('vj:records-refresh'));
      showInvoiceSuccess(result.record);
    } catch (error) {
      showAppMessage(committed ? 'The invoice was saved. Open Records to view it, then reload this page before creating another invoice.' : error.message, committed ? 'info' : 'error');
    } finally {
      invoiceSaving = false;
      controls.forEach(([element, disabled]) => { element.disabled = disabled; });
      window.dispatchEvent(new Event('vj:invoice-save-end'));
      setSaleStatus();
    }
  };
  document.getElementById('btnCompleteSale').addEventListener('click', () => saveInvoiceThroughApi('completed'));
  document.getElementById('btnSavePendingOrder').addEventListener('click', () => saveInvoiceThroughApi('pending'));
