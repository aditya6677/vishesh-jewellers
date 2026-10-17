function calculateDashboard(records, purchases, payments, ledger, range = {}) {
  const num = value => Number(String(value ?? 0).replace(/[^0-9.-]/g, '')) || 0;
  if (range.from || range.to) {
    const start = range.from ? new Date(range.from + 'T00:00:00').getTime() : -Infinity;
    const end = range.to ? new Date(range.to + 'T23:59:59.999').getTime() : Infinity;
    if (start > end || Number.isNaN(start) || Number.isNaN(end)) throw new Error('Choose a valid date range: From must be on or before To.');
    const time = value => new Date(value).getTime();
    const within = value => time(value) >= start && time(value) <= end;
    const invoiceDate = record => record.invoiceDate ? record.invoiceDate + 'T00:00:00' : record.savedAt;
    const result = calculateDashboard(records.filter(record => within(invoiceDate(record))), purchases.filter(entry => within(entry.savedAt)), payments.filter(entry => within(entry.savedAt)), ledger.filter(entry => within(entry.receivedAt)));
    const cash = (from, to) => records.filter(record => record.status !== 'voided').reduce((sum, record) => {
      const history = record.payments || [];
      const cashPayments = history.filter(entry => !['gold', 'silver'].includes(entry.method));
      const selected = cashPayments.reduce((total, entry) => {
        const date = time(entry.settledAt || record.savedAt);
        return total + (date >= from && date <= to ? num(entry.amount) : 0);
      }, 0);
      // Retain legacy cash without a transaction history, dated at creation.
      const adjustment = num(record.paid) - history.reduce((total, entry) => total + num(entry.amount), 0);
      const created = time(record.savedAt || invoiceDate(record));
      return sum + selected + (created >= from && created <= to ? adjustment : 0);
    }, 0);
    result.collected = cash(start, end);
    result.beforeParty = result.collected - result.purchases - result.expenses;
    result.afterPayment = result.beforeParty - result.party;
    const priorCost = entries => entries.filter(entry => time(entry.savedAt) < start).reduce((sum, entry) => sum + num(entry.amount), 0);
    result.openingCash = cash(-Infinity, start - 1) - priorCost(purchases) - priorCost(payments.filter(entry => ['amount', 'self-expense'].includes(entry.type)));
    result.closingCash = result.openingCash + result.afterPayment;
    for (const metal of ['gold', 'silver']) {
      result[metal].balance = ledger.filter(entry => (entry.metal || 'gold') === metal && time(entry.receivedAt) <= end).reduce((sum, entry) => sum + num(entry.weight), 0);
    }
    return result;
  }
  const active = records.filter(record => record.status !== 'voided');
  const sales = active.filter(record => record.status !== 'pending');
  const summary = {
    invoices: sales.length, pending: active.length - sales.length,
    sales: 0, collected: 0, due: 0, party: 0, expenses: 0, purchases: 0,
    gold: { sold: 0, sales: 0, received: 0, receivedValue: 0, balance: 0, paid: 0, finePaid: 0 },
    silver: { sold: 0, sales: 0, received: 0, receivedValue: 0, balance: 0, paid: 0, finePaid: 0 }
  };
  for (const record of active) {
    const metalSettlements = (record.payments || []).filter(payment => ['gold', 'silver'].includes(payment.method)).reduce((sum, payment) => sum + num(payment.amount), 0);
    summary.collected += num(record.paid) - metalSettlements;
    summary.due += num(record.due);
    if (record.status === 'pending') continue;
    summary.sales += Math.max(num(record.total) - num(record.returnTotal), 0);
    for (const item of record.soldItems || []) {
      const metal = String(item.purity).toLowerCase() === 'silver' ? summary.silver : summary.gold;
      const returns = (record.returns || []).flatMap(entry => entry.items || []).filter(entry => entry.lineId === item.lineId);
      const net = Math.max(num(item.net) - returns.reduce((sum, entry) => sum + num(entry.net), 0), 0);
      metal.sold += net;
      metal.sales += net * num(item.rate) * (1 + num(item.making) / 100);
    }
  }
  for (const purchase of purchases) summary.purchases += num(purchase.amount);
  for (const payment of payments) {
    if (payment.type === 'self-expense') summary.expenses += num(payment.amount);
    else if (payment.type === 'amount') summary.party += num(payment.amount);
    else if (payment.type === 'metal') {
      const metal = payment.metal === 'silver' ? summary.silver : summary.gold;
      metal.paid += num(payment.weight);
      metal.finePaid += num(payment.weight) * num(payment.purity) / 100;
    }
  }
  const voided = new Set(records.filter(record => record.status === 'voided').map(record => record.number));
  for (const entry of ledger) {
    const metal = entry.metal === 'silver' ? summary.silver : summary.gold;
    metal.balance += num(entry.weight);
    if (num(entry.weight) > 0 && !voided.has(entry.invoice) && ['Invoice exchange', 'Gold settlement', 'Silver settlement', 'Old metal purchase'].includes(entry.source)) {
      metal.received += num(entry.weight);
      metal.receivedValue += num(entry.value);
    }
  }
  summary.beforeParty = summary.collected - summary.purchases - summary.expenses;
  summary.afterPayment = summary.beforeParty - summary.party;
  summary.openingCash = 0;
  summary.closingCash = summary.afterPayment;
  return summary;
}
module.exports = { calculateDashboard };
