function applyWeightOnlyStockFlow(html) {
  const stockOptions = [
    'function stockOptionsHtml(selectedId, rowId){',
    "  const opts = ['<option value=\"\">— select a stock item —</option>'];",
    '  stockList.forEach(s=>{',
    '    const remainingNet = parseFloat(s.net)||0;',
    '    const remainingGross = parseFloat(s.gross)||0;',
    '    if(remainingNet <= 0 && remainingGross <= 0 && s.id !== selectedId) return;',
    '    opts.push(`<option value="${s.id}" ${s.id===selectedId?\'selected\':\'\'}>${escapeHtml(s.item)} · ${s.purity} · ${fmtWt(s.net)}g remaining</option>`);',
    '  });',
    "  return opts.join('');",
    '}',
    '',
    'function renderRowsTable()'
  ].join('\n');
  const completeSale = [
    "document.getElementById('btnCompleteSale').addEventListener('click', async ()=>{",
    '  if(saleCompleted) return;',
    "  const customerInput = document.getElementById('cust-name');",
    "  if(!customerInput.value.trim()){ toast('Customer name is required'); customerInput.focus(); return; }",
    "  if(rows.some(r => !r.stockId)){ toast('Select a stock item for every invoice row'); return; }",
    '  const linkedRows = rows.filter(r => r.stockId);',
    '  if(!linkedRows.length){',
    "    toast('Add at least one item from stock');",
    '    return;',
    '  }',
    '  for(const row of linkedRows){',
    '    if(!((parseFloat(row.gross) > 0) || (parseFloat(row.net) > 0)) || !(parseFloat(row.rate) > 0)){',
    "      toast('Enter a gross or net weight and rate for every stock item');",
    '      return;',
    '    }',
    '  }',
    '  const requested = new Map();',
    '  linkedRows.forEach(r=>{',
    '    const current = requested.get(r.stockId) || { gross:0, net:0, name:r.name };',
    '    current.gross += parseFloat(r.gross)||0;',
    '    current.net += parseFloat(r.net)||0;',
    '    requested.set(r.stockId, current);',
    '  });',
    '  for(const [stockId, requestedWeight] of requested){',
    '    const stock = stockList.find(x=>x.id===stockId);',
    '    if(!stock || requestedWeight.gross > (parseFloat(stock.gross)||0) + 0.0001 || requestedWeight.net > (parseFloat(stock.net)||0) + 0.0001){',
    "      toast('Not enough remaining weight for \"' + requestedWeight.name + '\"');",
    '      return;',
    '    }',
    '  }',
    '  requested.forEach((requestedWeight, stockId)=>{',
    '    const stock = stockList.find(x=>x.id===stockId);',
    '    stock.gross = Math.max((parseFloat(stock.gross)||0) - requestedWeight.gross, 0);',
    '    stock.net = Math.max((parseFloat(stock.net)||0) - requestedWeight.net, 0);',
    '    stock.qty = 1;',
    '  });',
    "  await storeSet('stock-list', stockList);",
    '  renderStockTable(); renderStockStats();',
    '  saleCompleted = true;',
    '  setSaleStatus();',
    "  toast('Stock weight updated — sale recorded');",
    '});',
    '',
    "document.getElementById('btnPrint')"
  ].join('\n');
  const renderStockStats = [
    'function renderStockStats(){',
    "  const goldStock = stockList.filter(stock => stock.purity !== 'Silver');",
    "  const silverStock = stockList.filter(stock => stock.purity === 'Silver');",
    '  const updateCard = (valueId, label, entries) => {',
    '    const weight = entries.reduce((sum, entry) => sum + (parseFloat(entry.gross)||0), 0);',
    '    const value = document.getElementById(valueId);',
    '    value.previousElementSibling.textContent = label;',
    "    value.innerHTML = fmtWt(weight) + ' g <small>' + entries.length + ' entries</small>';",
    '  };',
    "  updateCard('stat-count', 'Gold Entries', goldStock);",
    "  updateCard('stat-weight', 'Silver Entries', silverStock);",
    '}',
    '',
    'function renderStockTable()'
  ].join('\n');

  return html
    .replace(/function availableQtyFor\(stockEntry, excludingRowId\)\{[\s\S]*?\n\}\n\nfunction stockOptionsHtml/, "function availableQtyFor(stockEntry, excludingRowId){\n  return (parseFloat(stockEntry.net)||0) > 0 ? 1 : 0;\n}\n\nfunction stockOptionsHtml")
    .replace(/function stockOptionsHtml\(selectedId, rowId\)\{[\s\S]*?\n\}\n\nfunction renderRowsTable\(\)/, stockOptions)
    .replace('          row.gross = s.qty ? (s.gross / s.qty).toFixed(3) : s.gross;\n          row.net = s.qty ? (s.net / s.qty).toFixed(3) : s.net;', "          row.gross = '';\n          row.net = '';")
    .replace('class="f-stock">', 'class="f-stock" required>')
    .replace('class="f-name" value="${escapeHtml(r.name)}" placeholder="Item name">', 'class="f-name" value="${escapeHtml(r.name)}" placeholder="Select from stock" readonly>')
    .replace('class="f-hsn" value="${escapeHtml(r.hsn)}" style="width:56px;">', 'class="f-hsn" value="${escapeHtml(r.hsn)}" style="width:56px;" readonly>')
    .replace(/\$\{r\.stockId\?'readonly':''\}/g, '')
    .replace('<select class="f-purity">', '<select class="f-purity" ${r.stockId?\'disabled\':\'\'}>')
    .replace("tr.querySelector('.f-gross').addEventListener('input', e=>{ row.gross = e.target.value; renderRowsTable(); renderPreview(); });", "tr.querySelector('.f-gross').addEventListener('input', e=>{ row.gross = e.target.value; tr.querySelector('.amount-cell').textContent = '₹'+fmt(rowAmount(row)); renderPreview(); });")
    .replace("tr.querySelector('.f-net').addEventListener('input', e=>{ row.net = e.target.value; renderRowsTable(); renderPreview(); });", "tr.querySelector('.f-net').addEventListener('input', e=>{ row.net = e.target.value; tr.querySelector('.amount-cell').textContent = '₹'+fmt(rowAmount(row)); renderPreview(); });")
    .replace("tr.querySelector('.f-rate').addEventListener('input', e=>{ row.rate = e.target.value; renderRowsTable(); renderPreview(); });", "tr.querySelector('.f-rate').addEventListener('input', e=>{ row.rate = e.target.value; tr.querySelector('.amount-cell').textContent = '₹'+fmt(rowAmount(row)); renderPreview(); });")
    .replace("tr.querySelector('.f-making').addEventListener('input', e=>{ row.making = e.target.value; renderRowsTable(); renderPreview(); });", "tr.querySelector('.f-making').addEventListener('input', e=>{ row.making = e.target.value; tr.querySelector('.amount-cell').textContent = '₹'+fmt(rowAmount(row)); renderPreview(); });")
    .replace(/function renderStockStats\(\)\{[\s\S]*?\n\}\n\nfunction renderStockTable\(\)/, renderStockStats)
    .replace(/document\.getElementById\('btnCompleteSale'\)\.addEventListener\('click', async \(\)=>\{[\s\S]*?\n\}\);\n\ndocument\.getElementById\('btnPrint'\)/, completeSale);
}

module.exports = { applyWeightOnlyStockFlow };
