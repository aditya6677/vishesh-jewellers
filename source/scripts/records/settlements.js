  document.getElementById('recordsTbody').addEventListener('change', event => {
    if (!event.target.classList.contains('record-method')) return;
    const index = event.target.dataset.index;
    const isItem = event.target.value === 'gold' || event.target.value === 'silver';
    document.querySelector('[data-amount-field="' + index + '"]').style.display = isItem ? 'none' : 'block';
    document.querySelectorAll('[data-item-field="' + index + '"]').forEach(field => { field.style.display = isItem ? 'block' : 'none'; });
    document.getElementById('settlement-' + index).setAttribute('aria-required', String(!isItem));
    document.getElementById('settlement-weight-' + index).setAttribute('aria-required', String(isItem));
    document.getElementById('settlement-rate-' + index).setAttribute('aria-required', String(isItem));
    const button = document.querySelector('.record-settle[data-index="' + index + '"]');
    button.textContent = isItem ? 'Settle ' + (event.target.value === 'gold' ? 'Gold' : 'Silver') : 'Settle Amount';
  });
  document.getElementById('recordsTbody').addEventListener('input', event => {
    const id = event.target.id || '';
    if (!id.startsWith('settlement-weight-') && !id.startsWith('settlement-rate-')) return;
    const index = id.replace('settlement-weight-', '').replace('settlement-rate-', '');
    const weight = Number(document.getElementById('settlement-weight-' + index).value) || 0;
    const rate = Number(document.getElementById('settlement-rate-' + index).value) || 0;
    document.getElementById('settlement-value-' + index).textContent = money(weight * rate);
  });
  let settlementBusy = false;
  document.getElementById('recordsTbody').addEventListener('click', async event => {
    const button = event.target.closest('button[data-index]');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (button.classList.contains('record-toggle')) {
      const detail = document.querySelector('[data-detail="' + index + '"]');
      const opening = detail.style.display === 'none';
      detail.style.display = opening ? 'table-row' : 'none';
      button.textContent = opening ? 'Hide' : 'Details';
      return;
    }
    if (settlementBusy) return;
    let records;
    try { records = await getRecords(); }
    catch (error) { showAppMessage(error.message, 'error'); return; }
    if (settlementBusy) return;
    const record = records.find(entry => entry.number === button.dataset.number);
    if (!record) return;
    if (button.classList.contains('record-reprint')) {
      reprintInvoice(record);
      return;
    }
    if (button.classList.contains('record-edit')) {
      openEditInvoiceModal(record, records.indexOf(record));
      return;
    }
    if (button.classList.contains('record-void')) {
      openVoidModal(record, records.indexOf(record));
      return;
    }
    const due = Number(record.due) || 0;
    const settlementInput = document.getElementById('settlement-' + index);
    const method = document.querySelector('.record-method[data-index="' + index + '"]').value;
    const weight = Number(document.getElementById('settlement-weight-' + index).value);
    const rate = Number(document.getElementById('settlement-rate-' + index).value);
    const settled = button.classList.contains('record-paid') ? due : method === 'amount' ? Number(settlementInput.value) : weight * rate;
    if (!Number.isFinite(settled) || settled <= 0 || settled > due) {
      alert(method === 'amount' ? 'Enter a valid amount up to the outstanding due of ' + money(due) + '.' : 'Enter a valid weight and price per gram whose value does not exceed the due of ' + money(due) + '.');
      return;
    }
    settlementBusy = true;
    button.disabled = true;
    try {
      if (button.classList.contains('record-paid') && !(await confirmFullyPaid(record, due))) return;
      const response = await fetch('/api/records/' + encodeURIComponent(record.number) + '/settlements', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: button.dataset.version, method, amount: settled, weight, rate, fullyPaid: button.classList.contains('record-paid') })
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409 || response.status === 404) await renderRecords();
        throw new Error(result.error || 'Could not save settlement.');
      }
      await renderRecords();
      window.dispatchEvent(new Event('vj:transactions-updated'));
      showAppMessage('Settlement of ' + money(result.settled) + ' saved for invoice ' + record.number + '. Remaining due: ' + money(result.record.due) + '.', 'success');
    } catch (error) { showAppMessage(error.message, 'error'); }
    finally { settlementBusy = false; button.disabled = false; }
  });

