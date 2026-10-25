'use strict';

const { calculateDashboard } = require('../dashboard-summary');
const { StorageKey } = require('../domain/constants');

class DashboardService {
  constructor(store) { this.store = store; }

  snapshot(range = {}) {
    const data = this.store.read();
    const number = value => Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0;
    // Match normalization performed by the existing Records repository.
    const records = (data[StorageKey.INVOICES] || []).map(entry => {
      const record = { ...entry, paid: Number(entry.paid) || 0, payments: Array.isArray(entry.payments) ? entry.payments : [] };
      const missingDue = !Object.prototype.hasOwnProperty.call(record, 'due');
      const legacyZeroDue = number(record.total) > 0 && record.paid === 0 && Number(record.due) === 0 && record.payments.length === 0;
      if (missingDue || legacyZeroDue) record.due = Math.max(number(record.total) - record.paid, 0);
      return record;
    });
    const ledger = data[StorageKey.OLD_METAL] || [];
    const summary = calculateDashboard(records, data[StorageKey.PURCHASES] || [], data[StorageKey.PAYMENTS] || [], ledger, range);
    const stock = data[StorageKey.STOCK] || [];
    const fresh = {};
    const old = {};
    for (const metal of ['gold', 'silver']) {
      fresh[metal] = stock.reduce((sum, entry) => {
        const isSilver = String(entry.purity || '').toLowerCase() === 'silver';
        return sum + ((metal === 'silver') === isSilver ? Number(entry.net) || Number(entry.gross) || 0 : 0);
      }, 0);
      old[metal] = ledger.filter(entry => String(entry.metal || 'gold').toLowerCase() === metal).reduce((sum, entry) => sum + (Number(entry.weight) || 0), 0);
    }
    return { summary, fresh, old, lowStockLimits: { gold: 10, silver: 100 } };
  }
}

module.exports = { DashboardService };
