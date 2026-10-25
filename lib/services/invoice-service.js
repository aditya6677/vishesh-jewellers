'use strict';

const { deleteInvoice } = require('../delete-invoice');

class InvoiceService {
  constructor(store) {
    this.store = store;
  }

  delete(number) {
    // Calculate every reversal before writing the updated encrypted store once.
    const next = deleteInvoice(this.store.read(), number);
    this.store.write(next);
  }
}

module.exports = { InvoiceService };
