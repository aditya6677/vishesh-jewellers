  let dashboardRange = {};
  const renderDashboard = async (forceLiveRates = false) => {
    const records = await getRecords();
    const purchases = await getPurchases();
    const payments = await getPayments();
    const ledger = await getOldGold();
    const summary = dashboardSummary(records, purchases, payments, ledger, dashboardRange);
    document.getElementById('dashboardRangeLabel').textContent = dashboardRange.from || dashboardRange.to ? (dashboardRange.from || 'Beginning') + ' → ' + (dashboardRange.to || 'Present') : 'All time';
    const metric = (label, value, unit = 'money', emphasis = false) => '<div class="record-info"><b>' + safe(label) + '</b><span class="' + (emphasis ? 'dashboard-total ' : '') + (value < 0 ? 'dashboard-negative' : '') + '">' + (unit === 'weight' ? value.toFixed(3) + ' g' : unit === 'count' ? value : money(value)) + '</span></div>';
    const section = (title, content) => '<div class="snapshot-section"><h4>' + title + '</h4><div class="record-info-grid">' + content + '</div></div>';
    document.getElementById('dashboardSnapshot').innerHTML =
      section('Gold Sales', metric('Total gold sold · net weight', summary.gold.sold, 'weight') + metric('Gold item amount', summary.gold.sales)) +
      section('Silver Sales', metric('Total silver sold · net weight', summary.silver.sold, 'weight') + metric('Silver item amount', summary.silver.sales)) +
      section('Total Sales', metric('Gold + silver item amount', summary.gold.sales + summary.silver.sales) + metric('Final invoice sales', summary.sales) + metric('Completed invoices', summary.invoices, 'count') + metric('Pending orders', summary.pending, 'count')) +
      section('Old Metal Received', metric('Total old gold received', summary.gold.received, 'weight') + metric('Old gold value', summary.gold.receivedValue) + metric('Total old silver received', summary.silver.received, 'weight') + metric('Old silver value', summary.silver.receivedValue)) +
      section('Customer Collections', metric('Amount paid by customers', summary.collected) + metric('Outstanding due', summary.due) + metric('Remaining before party payments', summary.beforeParty)) +
      section('Outgoing Amounts', metric('Payment to party', summary.party) + metric('Old gold / silver purchases', summary.purchases) + metric('Expenses · Self Expense', summary.expenses)) +
      section('Metal Payments / Melting', metric('Gold gross weight paid', summary.gold.paid, 'weight') + metric('Gold fine weight paid', summary.gold.finePaid, 'weight') + metric('Silver gross weight paid', summary.silver.paid, 'weight') + metric('Silver fine weight paid', summary.silver.finePaid, 'weight')) +
      section('After Payment', metric('Old gold · closing balance', summary.gold.balance, 'weight', true) + metric('Old silver · closing balance', summary.silver.balance, 'weight', true) + metric('Period amount after payment', summary.afterPayment, 'money', true) + metric('Opening cash', summary.openingCash) + metric('Closing cash', summary.closingCash, 'money', true));
    let summaryNote = document.getElementById('dashboardSummaryNote');
    if (!summaryNote) {
      summaryNote = document.createElement('p'); summaryNote.id = 'dashboardSummaryNote'; summaryNote.className = 'dashboard-note';
      document.getElementById('dashboardSnapshot').after(summaryNote);
    }
    summaryNote.textContent = 'After Payment = customer money received − party payments − old-metal purchases − expenses. Includes pending-order advances; excludes metal settlements from cash. Item amounts include making, before GST and deductions. Old metal received includes purchases, exchange and settlements. Totals cover records stored in this app; previous-period and fine-metal opening balances have not been imported.';
    summaryNote.textContent += ' Date filters use invoice dates for sales and transaction dates for collections and outgoings. Closing balances include earlier transactions. Due is the current due of invoices in the selected period. Fresh stock and market rates below are current. Historical reports reflect subsequent edits and deletions.';
    const stockResult = await window.storage.get('stock-list');
    const stockList = stockResult ? JSON.parse(stockResult.value) : [];
    const remainingWeight = metal => stockList.reduce((total, stock) => {
      const isSilver = String(stock.purity || '').toLowerCase() === 'silver';
      if ((metal === 'silver') !== isSilver) return total;
      return total + (Number(stock.net) || Number(stock.gross) || 0);
    }, 0);
    const goldRemaining = remainingWeight('gold');
    const silverRemaining = remainingWeight('silver');
    document.getElementById('dash-gold').textContent = goldRemaining.toFixed(3) + ' g';
    document.getElementById('dash-silver').textContent = silverRemaining.toFixed(3) + ' g';
    const lowStockLimits = { gold: 10, silver: 100 };
    const lowStockMetals = [
      { label: 'Gold', remaining: goldRemaining, limit: lowStockLimits.gold },
      { label: 'Silver', remaining: silverRemaining, limit: lowStockLimits.silver }
    ].filter(metal => metal.remaining <= metal.limit);
    const lowStockPanel = document.getElementById('lowStockPanel');
    document.getElementById('lowStockList').innerHTML = lowStockMetals.map(metal =>
      '<div class="low-stock-item"><b>' + metal.label + ' is running low</b><span>' + metal.remaining.toFixed(3) + ' g remaining · Alert below ' + metal.limit.toFixed(3) + ' g</span></div>'
    ).join('');
    lowStockPanel.style.display = lowStockMetals.length ? 'block' : 'none';
    const oldMetalEntries = await getOldGold();
    const oldMetalWeight = metal => oldMetalEntries.filter(entry => String(entry.metal || 'gold').toLowerCase() === metal).reduce((total, entry) => total + (Number(entry.weight) || 0), 0);
    document.getElementById('dash-old-gold').textContent = oldMetalWeight('gold').toFixed(3) + ' g';
    document.getElementById('dash-old-silver').textContent = oldMetalWeight('silver').toFixed(3) + ' g';
    document.querySelectorAll('#page-dashboard .val, #page-dashboard .record-info > span').forEach(element => {
      element.classList.toggle('dashboard-negative', amount(element.textContent) < 0);
    });
    const liveRatesPanel = document.getElementById('liveRatesPanel');
    try {
      const response = await fetch('/api/live-rates' + (forceLiveRates ? '?refresh=1' : ''), { cache: 'no-store' });
      if (!response.ok) throw new Error('No live rate data');
      const liveRates = await response.json();
      document.getElementById('liveGoldRate').textContent = money(liveRates.goldPerGram);
      document.getElementById('liveSilverRate').textContent = money(liveRates.silverPerGram);
      const showRateChange = (id, change, previousQuote) => {
        const element = document.getElementById(id);
        const percentage = Number(change);
        if (!previousQuote || !Number.isFinite(percentage)) { element.hidden = true; return; }
        element.hidden = false;
        element.className = 'rate-change ' + (percentage > 0.0001 ? 'rate-change-up' : percentage < -0.0001 ? 'rate-change-down' : 'rate-change-flat');
        element.textContent = (percentage > 0 ? '+' : '') + percentage.toFixed(2) + '% vs ' + previousQuote.quoteDate + ' ' + previousQuote.session;
      };
      showRateChange('liveGoldChange', liveRates.goldChangePercent, liveRates.previousQuote);
      showRateChange('liveSilverChange', liveRates.silverChangePercent, liveRates.previousQuote);
      document.querySelector('#liveRatesPanel h3').textContent = 'IBJA Benchmark Rates';
      document.querySelector('#liveGoldRate').previousElementSibling.textContent = 'Gold 999 / 24K (₹/g)';
      document.querySelector('#liveSilverRate').previousElementSibling.textContent = 'Silver 999 (₹/g)';
      document.getElementById('liveRatesUpdated').textContent = liveRates.quoteDate + ' · ' + liveRates.session;
      liveRatesPanel.style.display = 'block';
    } catch (_) {
      liveRatesPanel.style.display = 'none';
    }
  };
