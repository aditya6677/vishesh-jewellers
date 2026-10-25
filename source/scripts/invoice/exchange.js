  const amount = value => Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0;
  const hiddenExchangeInput = document.getElementById('exchange-disc');
  const originalExchangeField = hiddenExchangeInput.closest('.field');
  originalExchangeField.style.display = 'none';
  const exchangePanel = document.createElement('div');
  exchangePanel.className = 'exchange-panel';
  exchangePanel.innerHTML = '<div class="toolbar"><div class="exchange-panel-title" style="margin:0;">Gold / Silver Exchange</div><button class="btn btn-ghost btn-sm" id="addExchangeRow" type="button">+ Add item</button></div><p class="sub" style="margin:0 0 12px;">Add each exchanged gold or silver item separately.</p><div class="exchange-rows" id="exchangeRows"></div><div class="field exchange-total" style="margin-bottom:0;"><label>Total exchange credit (₹)</label><div class="payment-balance" id="exchange-value">₹0.00</div></div>';
  originalExchangeField.parentElement.parentElement.insertBefore(exchangePanel, originalExchangeField.parentElement);
  const exchangeRows = document.getElementById('exchangeRows');
  const addExchangeRow = (entry = {}, required = false) => {
    const row = document.createElement('div');
    row.className = 'exchange-row';
    row.dataset.required = required ? 'true' : 'false';
    row.innerHTML = '<div class="field"><label>Metal</label><select class="exchange-row-metal"><option value="gold">Gold</option><option value="silver">Silver</option></select></div><div class="field"><label>Weight (g)</label><input class="exchange-row-weight" type="number" value="' + (Number(entry.weight) || 0) + '" min="0" step="0.001" placeholder="0.000"></div><div class="field"><label>Rate / gram (₹)</label><input class="exchange-row-rate" type="number" value="' + (Number(entry.rate) || 0) + '" min="0" step="0.01" placeholder="0.00"></div><div class="field"><label>Value</label><div class="exchange-row-value">₹0.00</div></div><button class="btn btn-ghost btn-sm exchange-remove" type="button" title="Remove item" aria-label="Remove exchange item">×</button>';
    if (required) {
      ['.exchange-row-weight', '.exchange-row-rate'].forEach(selector => {
        const input = row.querySelector(selector);
        input.setAttribute('aria-required', 'true');
        input.closest('.field').querySelector('label').textContent += ' *';
      });
    }
    row.querySelector('.exchange-row-metal').value = entry.metal === 'silver' ? 'silver' : 'gold';
    exchangeRows.appendChild(row);
    return row;
  };
  const getExchangeEntries = () => Array.from(exchangeRows.querySelectorAll('.exchange-row')).map(row => {
    const metal = row.querySelector('.exchange-row-metal').value;
    const weight = Math.max(Number(row.querySelector('.exchange-row-weight').value) || 0, 0);
    const rate = Math.max(Number(row.querySelector('.exchange-row-rate').value) || 0, 0);
    return { metal, weight, rate, value: weight * rate };
  });
  const updateExchangeValue = () => {
    const entries = getExchangeEntries();
    const value = entries.reduce((total, entry) => total + entry.value, 0);
    const manualDiscount = Math.max(Number(document.getElementById('invoice-discount') && document.getElementById('invoice-discount').value) || 0, 0);
    const formatExchangeMoney = amount => '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    exchangeRows.querySelectorAll('.exchange-row').forEach((row, index) => { row.querySelector('.exchange-row-value').textContent = formatExchangeMoney(entries[index].value); });
    document.getElementById('exchange-value').textContent = formatExchangeMoney(value);
    hiddenExchangeInput.value = (value + manualDiscount).toFixed(2);
    hiddenExchangeInput.dispatchEvent(new Event('input', { bubbles: true }));
  };
  document.getElementById('addExchangeRow').addEventListener('click', () => { addExchangeRow({}, true); updateExchangeValue(); });
  exchangeRows.addEventListener('input', updateExchangeValue);
  exchangeRows.addEventListener('change', updateExchangeValue);
  exchangeRows.addEventListener('click', event => {
    const button = event.target.closest('.exchange-remove');
    if (!button) return;
    button.closest('.exchange-row').remove();
    if (!exchangeRows.children.length) addExchangeRow();
    updateExchangeValue();
  });
  addExchangeRow();
  updateExchangeValue();
