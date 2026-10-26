import { useEffect, useState } from 'react';
import { money } from '../components/Metric';

function readMoney(value: string | null | undefined): number {
  return Number(String(value || '').replace(/[^\d.-]/g, '')) || 0;
}

function updatePreviewPaymentLine(paid: number, total: number) {
  const totals = document.getElementById('p-totals');
  if (!totals) return;
  totals.querySelector('.payment-summary-line')?.remove();
  const difference = total - paid;
  const line = document.createElement('div');
  line.className = 'tl payment-summary-line';
  line.innerHTML = `<span>${difference >= 0 ? 'Amount Due' : 'Excess / Plus Amount'}</span><b>${money(Math.abs(difference))}</b>`;
  totals.append(line);
}

export function InvoicePaymentSummary() {
  const [discount, setDiscount] = useState('0');
  const [paid, setPaid] = useState('0');
  const [grandTotal, setGrandTotal] = useState(0);

  useEffect(() => {
    const refresh = () => {
      const total = readMoney(document.getElementById('mini-grand')?.textContent);
      setGrandTotal(total);
      updatePreviewPaymentLine(readMoney((document.getElementById('amount-paid') as HTMLInputElement | null)?.value), total);
    };
    const reset = () => {
      setDiscount('0');
      setPaid('0');
      const exchangeRows = document.getElementById('exchangeRows');
      const addExchangeButton = document.getElementById('addExchangeRow') as HTMLButtonElement | null;
      exchangeRows?.replaceChildren();
      addExchangeButton?.click();
      window.setTimeout(() => {
        updateExchangeDeduction('0');
        refresh();
      }, 0);
    };
    const newInvoiceButton = document.getElementById('btnNewInvoice');
    document.addEventListener('input', refresh);
    document.addEventListener('change', refresh);
    newInvoiceButton?.addEventListener('click', reset);
    window.setTimeout(refresh, 0);
    return () => {
      document.removeEventListener('input', refresh);
      document.removeEventListener('change', refresh);
      newInvoiceButton?.removeEventListener('click', reset);
    };
  }, []);

  useEffect(() => updatePreviewPaymentLine(readMoney(paid), grandTotal), [paid, grandTotal]);

  const updateExchangeDeduction = (nextDiscount: string) => {
    const exchangeValue = readMoney(document.getElementById('exchange-value')?.textContent);
    const exchangeInput = document.getElementById('exchange-disc') as HTMLInputElement | null;
    if (!exchangeInput) return;
    exchangeInput.value = (exchangeValue + Math.max(Number(nextDiscount) || 0, 0)).toFixed(2);
    exchangeInput.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const balance = grandTotal - (Number(paid) || 0);
  const isDue = balance >= 0;

  return <div className="row row-3 invoice-payment-summary">
    <div className="field">
      <label htmlFor="invoice-discount">Discount (₹)</label>
      <input id="invoice-discount" type="number" min="0" step="0.01" value={discount} placeholder="0.00"
        onChange={event => { setDiscount(event.target.value); updateExchangeDeduction(event.target.value); }} />
    </div>
    <div className="field">
      <label htmlFor="amount-paid">Amount Paid (₹)</label>
      <input id="amount-paid" type="number" min="0" step="0.01" value={paid} placeholder="0.00"
        onChange={event => setPaid(event.target.value)} />
    </div>
    <div className="field">
      <label>{isDue ? 'Amount Due (₹)' : 'Excess / Plus Amount (₹)'}</label>
      <output className={'payment-balance ' + (isDue ? 'due-amount' : 'plus-amount')}>{money(Math.abs(balance))}</output>
    </div>
  </div>;
}
