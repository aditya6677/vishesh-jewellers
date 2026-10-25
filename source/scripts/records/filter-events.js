  document.getElementById('recordSearch').addEventListener('input', () => { window._tablePaginationState.recordsTbody.page = 1; renderRecords(); });
  document.getElementById('recordStatusFilter').addEventListener('change', () => { window._tablePaginationState.recordsTbody.page = 1; renderRecords(); });
  const updateRecordDateRange = event => {
    const fromInput = document.getElementById('recordFrom');
    const toInput = document.getElementById('recordTo');
    if (fromInput.value && toInput.value && fromInput.value > toInput.value) {
      showAppMessage('From date must be on or before To date.', 'error');
      if (event.target === fromInput) fromInput.value = '';
      else toInput.value = '';
    }
    fromInput.max = toInput.value;
    toInput.min = fromInput.value;
    window._tablePaginationState.recordsTbody.page = 1;
    renderRecords();
  };
  document.getElementById('recordFrom').addEventListener('change', updateRecordDateRange);
  document.getElementById('recordTo').addEventListener('change', updateRecordDateRange);
  document.getElementById('clearRecordDates').addEventListener('click', () => {
    document.getElementById('recordFrom').value = '';
    document.getElementById('recordTo').value = '';
    document.getElementById('recordFrom').removeAttribute('max');
    document.getElementById('recordTo').removeAttribute('min');
    window._tablePaginationState.recordsTbody.page = 1;
    renderRecords();
  });
