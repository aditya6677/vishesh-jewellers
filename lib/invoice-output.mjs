export function printInvoice(flush, print) {
  flush();
  print();
}

export async function downloadInvoicePdf(node, number, html2canvas, Pdf) {
  if (!node || typeof html2canvas !== 'function' || typeof Pdf !== 'function') throw new Error('PDF tools are unavailable. Try Print instead.');
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#FAF5E7' });
  const image = canvas.toDataURL('image/png');
  const pdf = new Pdf('p', 'pt', 'a4');
  const width = pdf.internal.pageSize.getWidth() - 40;
  const height = canvas.height * (width / canvas.width);
  pdf.addImage(image, 'PNG', 20, 20, width, height);
  pdf.save('Invoice-' + (number || 'invoice') + '.pdf');
}
