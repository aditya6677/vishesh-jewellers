'use strict';
function balances(db, storeId, { excludeSource = null, excludeInvoice = null, legacyDefault = false } = {}) {
  const field = legacyDefault ? "coalesce(nullif(source_metal,''),'gold')" : 'source_metal';
  return Object.fromEntries(['gold', 'silver'].map(metal => {
    const filters = ['store_id=?', field + '=?'], args = [storeId, metal];
    if (excludeSource !== null) { filters.push('(source_id IS NULL OR source_id<>?)'); args.push(excludeSource); }
    if (excludeInvoice !== null) { filters.push('(invoice IS NULL OR invoice<>?)'); args.push(excludeInvoice); }
    const value = db.prepare(`SELECT vj_sum(guard_weight) AS total FROM (SELECT guard_weight FROM metal_movements WHERE ${filters.join(' AND ')} ORDER BY ordinal)`).get(...args).total || 0;
    if (!Number.isFinite(value)) throw new Error('Resulting metal balance is too large.');
    return [metal, value];
  }));
}
module.exports = { balances };
