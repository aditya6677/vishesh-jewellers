  const previewField = id => document.getElementById(id)?.value || '';
  window.vjInvoicePreviewSource = {
    read: () => {
      const totals = computeTotals();
      return {
        business: { name: previewField('biz-name') || 'Vishesh Jewellers', gstin: previewField('biz-gstin'), phone: previewField('biz-phone'), email: previewField('biz-email'), address: previewField('biz-address'), ...(typeof bizInfo === 'undefined' ? {} : { tagline: bizInfo.tagline, logo: bizInfo.logo }) },
        customer: { gstin: previewField('customer-gstin'), name: previewField('cust-name') || 'Customer Name', address: previewField('cust-address'), mobile: previewField('cust-mobile') },
        number: previewField('inv-no') || '—', date: formatDateDisplay(previewField('inv-date')),
        items: rows.filter(row => row.name || row.net || row.rate).map(row => ({ ...row, amount: rowAmount(row) })),
        totals, paid: Number(previewField('amount-paid')) || 0, terms: previewField('inv-terms'), taxValue: previewField('gst-rate'), taxTreatment: previewField('invoice-tax-treatment') || 'gst',
        words: totals.grand > 0 ? 'Rs. ' + numToWords(totals.grand) + ' Only' : ''
      };
    },
    tax: value => {
      if (!['0', '1.5', 'b2b'].includes(value)) return;
      const treatment = document.getElementById('invoice-tax-treatment');
      if (treatment) treatment.value = value === 'b2b' ? 'b2b' : value === '0' ? 'estimate' : 'gst';
      const input = document.getElementById('gst-rate');
      input.value = value === 'b2b' ? '1.5' : value;
      if (input.options) input.selectedIndex = Array.from(input.options).findIndex(option => value === 'b2b' ? option.dataset.treatment === 'b2b' : option.value === value && !option.dataset.treatment);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    customerGstin: value => {
      const input = document.getElementById('customer-gstin');
      input.value = value.toUpperCase();
      renderPreview();
    },
    terms: value => {
      const input = document.getElementById('inv-terms');
      input.value = value === 'b2b' ? '1.5' : value;
      if (input.options) input.selectedIndex = Array.from(input.options).findIndex(option => value === 'b2b' ? option.dataset.treatment === 'b2b' : option.value === value && !option.dataset.treatment);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
