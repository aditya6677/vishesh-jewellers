import { money } from '../transactions/TransactionForm';
import { savedInvoiceMarkup } from './saved-invoice';
import { editSummary, type EditDraft, type EditableRecord } from './editor-model';

export function editedInvoiceMarkup(record: EditableRecord, draft: EditDraft): string {
  const document = new DOMParser().parseFromString(savedInvoiceMarkup(record), 'text/html');
  const paper = document.querySelector<HTMLElement>('#invoicePaper')!;
  const totals = editSummary(record, draft);
  const text = (selector: string, value: string) => { const element = paper.querySelector(selector); if (element) element.textContent = value; };
  const date = new Date(draft.invoiceDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  text('#p-cust-name', draft.customer.trim()); text('#p-cust-address', [draft.address.trim(), draft.mobile.trim() ? 'Mob: ' + draft.mobile.trim() : ''].filter(Boolean).join(' · '));
  text('#p-date', date); text('#p-terms', draft.terms.trim());
  text('#p-gstin', Number(draft.gstRate) === 0 ? 'NON-GST INVOICE' : 'GSTIN: ' + (record.gstin || '—'));
  text('#p-words', totals.grand > 0 ? 'Rs. ' + window.vjInvoiceEditMath.words(totals.grand) + ' Only' : '');
  paper.querySelectorAll('.pending-invoice-watermark,.regenerated-settlement-history').forEach(element => element.remove());
  const body = paper.querySelector('#p-items-body');
  if (body) {
    body.replaceChildren();
    draft.items.forEach((item, index) => {
      const row = document.createElement('tr');
      [String(index + 1), item.name, item.hsn || '', item.purity, Number(item.gross).toFixed(3), Number(item.net).toFixed(3), String(item.pcs), Number(item.rate).toFixed(2), Number(item.making || 0).toFixed(2) + '%', window.vjInvoiceEditMath.totals([item], 0, 0).subtotal.toFixed(2)].forEach((value, column) => {
        const cell = document.createElement('td'); if (column >= 4 || column === 2) cell.className = 'num'; cell.textContent = value; row.append(cell);
      }); body.append(row);
    });
  }
  const panel = paper.querySelector('#p-totals');
  if (panel) {
    panel.replaceChildren();
    const lines: [string, number, string][] = [['Total', totals.subtotal, 'tl'], ['Exchange / Discount', totals.exchange + totals.discount, 'tl']];
    if (Number(draft.gstRate) > 0) lines.push(['CGST ' + Number(draft.gstRate) / 2 + '%', totals.cgst, 'tl'], ['SGST ' + Number(draft.gstRate) / 2 + '%', totals.sgst, 'tl']);
    lines.push(['Grand Total', totals.grand, 'gt']);
    for (const [label, value, className] of lines) {
      const row = document.createElement('div'); row.className = className;
      const title = document.createElement('span'); title.textContent = label;
      const number = document.createElement('b'); number.textContent = money(value); row.append(title, number); panel.append(row);
    }
  }
  return paper.outerHTML;
}
