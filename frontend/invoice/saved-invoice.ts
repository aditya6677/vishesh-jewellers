import type { InvoiceRecord } from '../types';
import { money } from '../transactions/TransactionForm';
import { balance } from '../records/RecordDetails';

// Historical invoice totals are snapshots: never recalculate their tax or prices.
export function savedInvoiceMarkup(record: InvoiceRecord & { invoiceMarkup?: string }): string {
  const document = new DOMParser().parseFromString(record.invoiceMarkup || '', 'text/html');
  let paper = document.querySelector<HTMLElement>('#invoicePaper');
  if (!paper) {
    paper = document.createElement('div'); paper.id = 'invoicePaper';
    for (const text of ['Vishesh Jewellers', 'Invoice: ' + record.number, 'Date: ' + (record.date || '—'), 'Customer: ' + (record.customer || 'Walk-in customer'), 'Mobile: ' + (record.mobile || '—'), 'Items: ' + (record.items || '—'), 'Total: ' + record.total]) {
      const line = document.createElement('p'); line.textContent = text; paper.append(line);
    }
  }
  // Treat saved HTML as data, not executable application code.
  const tags = new Set(['DIV', 'SPAN', 'P', 'B', 'STRONG', 'I', 'EM', 'SMALL', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'IMG']);
  for (const element of [paper, ...paper.querySelectorAll('*')]) {
    if (!tags.has(element.tagName)) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) {
      if (!['id', 'class', 'style', 'src', 'alt', 'colspan', 'rowspan', 'width', 'height'].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    const imageSource = element.getAttribute('src') || '';
    const embeddedLogo = imageSource.length <= 1_400_000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageSource);
    if (element.hasAttribute('src') && !/^\/assets\/[\w./-]+\.(png|jpg|jpeg|webp)$/i.test(imageSource) && !embeddedLogo) element.removeAttribute('src');
    if (/url\s*\(|expression\s*\(|@import|\\/i.test(element.getAttribute('style') || '')) element.removeAttribute('style');
  }
  const savedLogo = paper.querySelector('.invoice-logo')?.getAttribute('src') || '';
  if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(savedLogo)) paper.style.setProperty('--invoice-logo-image', `url("${savedLogo}")`);
  paper.querySelectorAll('#p-seal,.seal,.voided-invoice-watermark,.pending-invoice-watermark,.payment-summary-line,.regenerated-payment-line,.regenerated-settlement-history').forEach(element => element.remove());
  if (record.status === 'voided' || record.status === 'pending') {
    const watermark = document.createElement('div');
    watermark.className = record.status === 'voided' ? 'voided-invoice-watermark' : 'pending-invoice-watermark';
    watermark.textContent = record.status === 'voided' ? 'VOIDED' : 'PENDING DELIVERY'; paper.append(watermark);
  }
  let totals = paper.querySelector('#p-totals');
  if (!totals) { totals = document.createElement('div'); totals.id = 'p-totals'; paper.append(totals); }
  const paid = Number(record.paid) || 0;
  const remaining = record.status === 'voided' ? { label: 'Amount due', text: money(0), className: 'paid-amount' } : balance(record);
  for (const [label, value, color] of [['Amount Paid', money(paid), 'paid-amount'], [remaining.label, remaining.text, remaining.className]] as const) {
    const line = document.createElement('div'); line.className = 'tl regenerated-payment-line';
    const title = document.createElement('span'); title.textContent = label;
    const amount = document.createElement('b'); amount.textContent = value; amount.className = color;
    line.append(title, amount); totals.append(line);
  }
  const history = document.createElement('div'); history.className = 'words-line regenerated-settlement-history';
  history.textContent = record.payments?.length ? 'Settlement: ' + record.payments.map(payment => {
    const metal = payment.method === 'gold' || payment.method === 'silver';
    return (metal ? payment.method === 'gold' ? 'Gold' : 'Silver' : 'Amount') + (metal ? ' (' + payment.weight + 'g × ' + money(payment.rate || 0) + '/g)' : '') + ': ' + money(payment.amount || 0);
  }).join(' · ') : 'Settlement: No payment recorded';
  totals.after(history);
  return paper.outerHTML;
}
