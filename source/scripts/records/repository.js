  const getRecords = async () => {
    const result = await window.storage.get('invoice-records');
    return result ? JSON.parse(result.value).map(record => {
      record.paid = Number(record.paid) || 0;
      record.payments = Array.isArray(record.payments) ? record.payments : [];
      const missingDue = !Object.prototype.hasOwnProperty.call(record, 'due');
      const legacyZeroDue = amount(record.total) > 0 && record.paid === 0 && Number(record.due) === 0 && record.payments.length === 0;
      if (missingDue || legacyZeroDue) record.due = Math.max(amount(record.total) - record.paid, 0);
      return record;
    }) : [];
  };
  const money = value => '₹' + amount(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const getOldGold = async () => {
    const result = await window.storage.get('old-gold-records');
    return result ? JSON.parse(result.value) : [];
  };
