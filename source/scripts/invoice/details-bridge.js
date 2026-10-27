  const invoiceDetailsFields = ['biz-name', 'biz-gstin', 'biz-phone', 'biz-email', 'biz-address', 'cust-name', 'cust-mobile', 'cust-address', 'inv-no', 'inv-date', 'invoiceType'];
  window.vjInvoiceDetails = {
    read: () => Object.fromEntries(invoiceDetailsFields.map(id => [id, document.getElementById(id).value])),
    update: (id, value) => {
      if (!invoiceDetailsFields.includes(id) || id === 'inv-no') throw new Error('This invoice field is not editable.');
      const input = document.getElementById(id);
      input.value = value;
      input.dispatchEvent(new Event(id === 'invoiceType' ? 'change' : 'input', { bubbles: true }));
    },
    commitBusiness: id => {
      if (!invoiceDetailsFields.includes(id) || !id.startsWith('biz-')) return;
      document.getElementById(id).dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
