  const invoiceSuccessModal = document.createElement('div');
  invoiceSuccessModal.id = 'invoiceSuccessModal';
  invoiceSuccessModal.className = 'modal-backdrop';
  invoiceSuccessModal.innerHTML = '<div class="modal" style="max-width:430px; text-align:center;"><div class="invoice-success-icon">✓</div><h3 id="invoiceSuccessTitle" style="margin:0;">Invoice generated</h3><p class="void-modal-note" id="invoiceSuccessNote">Stock has been updated and the invoice was saved successfully.</p><div class="invoice-success-number" id="generatedInvoiceNumber">—</div><div class="btn-row" style="margin-top:18px; justify-content:center;"><button class="btn btn-gold" id="viewGeneratedInvoice">View Invoice</button><button class="btn btn-ghost" id="closeInvoiceSuccess">Done</button></div></div>';
  document.body.appendChild(invoiceSuccessModal);
  let generatedInvoiceRecord = null;
  const showInvoiceSuccess = record => {
    generatedInvoiceRecord = record;
    const pending = record.status === 'pending';
    document.getElementById('invoiceSuccessTitle').textContent = pending ? 'Pending order saved' : 'Invoice generated';
    document.getElementById('invoiceSuccessNote').textContent = pending ? 'The order was saved successfully. Stock will be selected and deducted only when you deliver it from Records.' : 'Stock has been updated and the invoice was saved successfully.';
    document.getElementById('viewGeneratedInvoice').textContent = pending ? 'View Pending Invoice' : 'View Invoice';
    document.getElementById('generatedInvoiceNumber').textContent = record.number;
    invoiceSuccessModal.classList.add('open');
  };
  document.getElementById('closeInvoiceSuccess').addEventListener('click', () => invoiceSuccessModal.classList.remove('open'));
  document.getElementById('viewGeneratedInvoice').addEventListener('click', () => {
    if (!generatedInvoiceRecord) return;
    invoiceSuccessModal.classList.remove('open');
    reprintInvoice(generatedInvoiceRecord);
  });
