'use strict';

// Shared read-only record rules; no storage or browser dependencies.
const amount = value => Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0;
  const dateForRecord = record => {
    if (record.invoiceDate && /^d{4}-d{2}-d{2}$/.test(record.invoiceDate)) {
      const invoiceDate = new Date(record.invoiceDate + 'T00:00:00');
      if (!Number.isNaN(invoiceDate.getTime())) return invoiceDate;
    }
    if (record.savedAt) {
      const savedDate = new Date(record.savedAt);
      if (!Number.isNaN(savedDate.getTime())) return savedDate;
    }
    const parts = String(record.date || '').split('/');
    return parts.length === 3 ? new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])) : new Date(0);
  };
  const recordNetTotal = record => Math.max(amount(record.total) - (Number(record.returnTotal) || 0), 0);
  const recordDateKey = record => {
    const validDateKey = value => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
      if (!match) return '';
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? match[0] : '';
    };
    const formatLocalDate = date => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    const invoiceDate = validDateKey(record.invoiceDate);
    if (invoiceDate) return invoiceDate;
    const displayDate = String(record.date || '').trim();
    let match = /^(\d{1,2})[\/. -](\d{1,2})[\/. -](\d{4})$/.exec(displayDate);
    if (match) {
      const day = String(match[1]).padStart(2, '0');
      const month = String(match[2]).padStart(2, '0');
      const parsed = validDateKey(match[3] + '-' + month + '-' + day);
      if (parsed) return parsed;
    }
    match = /^(\d{1,2})\s+([a-z]{3,})\s+(\d{4})$/i.exec(displayDate);
    if (match) {
      const month = new Date(Date.parse(match[2] + ' 1, 2000')).getMonth() + 1;
      const parsed = validDateKey(match[3] + '-' + String(month).padStart(2, '0') + '-' + String(match[1]).padStart(2, '0'));
      if (parsed) return parsed;
    }
    const savedAt = new Date(record.savedAt || '');
    return Number.isNaN(savedAt.getTime()) ? '' : formatLocalDate(savedAt);
  };
  const recordMatchesFilters = (record, query, statusFilter, from, to) => {
    if (!(record.number + ' ' + record.customer + ' ' + record.mobile).toLowerCase().includes(query)) return false;
    const invoiceDate = recordDateKey(record);
    if ((from || to) && !invoiceDate) return false;
    if (from && invoiceDate < from) return false;
    if (to && invoiceDate > to) return false;
    if (statusFilter === 'all') return true;
    if (statusFilter === 'voided') return record.status === 'voided';
    if (statusFilter === 'pending') return record.status === 'pending';
    if (record.status === 'voided' || record.status === 'pending') return false;
    const due = Math.max(Number(record.due) || 0, 0);
    const advance = Math.max((Number(record.paid) || 0) - recordNetTotal(record), 0);
    if (statusFilter === 'due') return due > 0.005;
    if (statusFilter === 'advance') return advance > 0.005;
    if (statusFilter === 'settled') return due <= 0.005 && advance <= 0.005;
    return true;
  };

module.exports = { recordMatchesFilters, recordDateKey, recordNetTotal };

