'use strict';

// Pure, partial audit of a caller-provided decrypted snapshot. No file access,
// coercive repairs, encryption-key generation or writes to the live JSON store.
const { StorageKey } = require('../domain/constants');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const numeric = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || !/^[₹\s,\d.+-]+$/.test(value) || !/\d/.test(value)) return NaN;
  return Number(value.replace(/[₹\s,]/g, ''));
};

function auditSnapshot(snapshot) {
  if (!object(snapshot)) throw new Error('A decrypted snapshot object is required.');
  const issues = [], counts = {};
  const add = (severity, collection, index, field, code) => issues.push({ severity, collection, index, field, code });
  for (const collection of Object.values(StorageKey)) {
    if (!Object.hasOwn(snapshot, collection)) { counts[collection] = 0; add('warning', collection, null, '', 'missing-collection'); continue; }
    const rows = snapshot[collection];
    if (!Array.isArray(rows)) { add('error', collection, null, '', 'collection-not-array'); continue; }
    counts[collection] = rows.length;
    const identities = new Set();
    rows.forEach((row, index) => {
      if (!object(row)) { add('error', collection, index, '', 'record-not-object'); return; }
      const field = collection === StorageKey.INVOICES ? 'number' : collection === StorageKey.OLD_METAL ? null : 'id';
      if (field) {
        const id = row[field];
        if (!['string', 'number'].includes(typeof id) || !String(id).trim()) add('error', collection, index, field, 'missing-identity');
        else if (identities.has(String(id))) add('error', collection, index, field, 'duplicate-identity');
        else identities.add(String(id));
      }
      const fields = collection === StorageKey.STOCK ? ['gross', 'net'] : collection === StorageKey.INVOICES ? ['total'] : collection === StorageKey.PURCHASES ? ['weight', 'rate', 'amount'] : collection === StorageKey.PAYMENTS ? row.type === 'metal' ? ['weight', 'purity', 'fineWeight'] : ['amount'] : ['weight'];
      for (const name of fields) {
        const number = numeric(row[name]);
        if (!Number.isFinite(number)) add('error', collection, index, name, 'invalid-number');
        else {
          if (number < 0 && collection !== StorageKey.OLD_METAL) add('error', collection, index, name, 'negative-value');
          const scale = ['weight', 'gross', 'net', 'fineWeight'].includes(name) ? 1000 : 100;
          const scaled = number * scale;
          if (!Number.isSafeInteger(Math.round(scaled))) add('error', collection, index, name, 'integer-overflow');
          else if (Math.abs(scaled - Math.round(scaled)) > 1e-7) add('warning', collection, index, name, 'precision-policy-required');
        }
      }
      if (collection === StorageKey.STOCK) {
        if (!Object.hasOwn(row, 'qty')) add('warning', collection, index, 'qty', 'legacy-quantity-policy-required');
        else if (!Number.isSafeInteger(numeric(row.qty)) || numeric(row.qty) < 0) add('error', collection, index, 'qty', 'invalid-quantity');
        if (numeric(row.net) > numeric(row.gross)) add('error', collection, index, 'net', 'net-exceeds-gross');
      }
      if (collection === StorageKey.INVOICES) {
        if (!['completed', 'pending', 'voided'].includes(row.status)) add('warning', collection, index, 'status', 'legacy-status-policy-required');
        if (row.weightMode !== 'line-total') add('warning', collection, index, 'weightMode', 'legacy-weight-policy-required');
      }
    });
  }
  const unknownKeys = Object.keys(snapshot).filter(key => !Object.values(StorageKey).includes(key));
  return { scope: 'partial-preflight-not-migration-approval', counts, issues, unknownKeys, blockingErrors: issues.filter(issue => issue.severity === 'error').length, requiresReview: issues.length > 0 || unknownKeys.length > 0 };
}

module.exports = { auditSnapshot };
