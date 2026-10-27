  document.getElementById('printRegeneratedInvoice').addEventListener('click', () => {
    const paper = document.querySelector('#regeneratedInvoiceContent #invoicePaper');
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('Please allow pop-ups to print the invoice.'); return; }
    printWindow.document.write('<!doctype html><html><head><title>Invoice ' + safe(regeneratedModal.dataset.invoiceNumber) + '</title><meta name="viewport" content="width=device-width,initial-scale=1"><link href="/vendor/fonts.css" rel="stylesheet">' + document.querySelector('style').outerHTML + '<style>body{background:#fff;padding:24px}#invoicePaper{max-width:800px;margin:auto}</style></head><body>' + paper.outerHTML + '</body></html>');
    printWindow.document.close();
  });
  document.getElementById('downloadRegeneratedInvoice').addEventListener('click', async () => {
    const paper = document.querySelector('#regeneratedInvoiceContent #invoicePaper');
    try {
      const canvas = await html2canvas(paper, { scale: 2, backgroundColor: '#FAF5E7' });
      const pdf = new window.jspdf.jsPDF('p', 'pt', 'a4');
      const width = pdf.internal.pageSize.getWidth() - 40;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 20, 20, width, canvas.height * (width / canvas.width));
      pdf.save('Invoice-' + regeneratedModal.dataset.invoiceNumber + '.pdf');
    } catch (error) { alert('Could not generate the PDF.'); }
  });
