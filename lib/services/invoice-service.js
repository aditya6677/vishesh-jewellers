'use strict';

const { deleteInvoice } = require('../delete-invoice');
const { createInvoice } = require('./invoice-creation');
const { editInvoice } = require('./invoice-editing');
const { voidInvoice } = require('./invoice-voiding');

class InvoiceService {
  constructor(store) {
    this.store = store;
  }

  delete(number) {
    // Calculate every reversal before writing the updated encrypted store once.
    const next = deleteInvoice(this.store.read(), number);
    this.store.write(next);
  }

  create(input) { return createInvoice(this.store, input); }
  edit(number, input) { return editInvoice(this.store, number, input); }
  void(number, input) { return voidInvoice(this.store, number, input); }
}

module.exports = { InvoiceService };
