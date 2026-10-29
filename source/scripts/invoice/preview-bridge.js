  const previewField = id => document.getElementById(id)?.value || '';
  window.vjInvoicePreviewSource = {
    read: () => {
      const totals = computeTotals();
      return {
        business: { name: previewField('biz-name') || 'Vishesh Jewellers', gstin: previewField('biz-gstin'), phone: previewField('biz-phone'), email: previewField('biz-email'), address: previewField('biz-address'), ...(typeof bizInfo === 'undefined' ? {} : { tagline: bizInfo.tagline, logo: bizInfo.logo }) },
        customer: { name: previewField('cust-name') || 'Customer Name', address: previewField('cust-address'), mobile: previewField('cust-mobile') },
        number: previewField('inv-no') || '—', date: formatDateDisplay(previewField('inv-date')),
        items: rows.filter(row => row.name || row.net || row.rate).map(row => ({ ...row, amount: rowAmount(row) })),
        totals, paid: Number(previewField('amount-paid')) || 0, terms: previewField('inv-terms'), taxValue: previewField('gst-rate'),
        words: totals.grand > 0 ? 'Rs. ' + numToWords(totals.grand) + ' Only' : ''
      };
    },
    tax: value => {
      if (!['0', '1.5'].includes(value)) return;
      const input = document.getElementById('gst-rate');
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    terms: value => {
      const input = document.getElementById('inv-terms');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
