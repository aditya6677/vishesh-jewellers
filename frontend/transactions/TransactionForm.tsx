import { useState } from 'react';
import { Select } from '../components/Select';
import type { Metal, PaymentType, TransactionEntry, TransactionInput, TransactionKind } from '../types';

export const money = (value: number = 0) => '₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const grams = (value: number = 0) => value.toFixed(3) + ' g';
export const paymentLabels: Record<PaymentType, string> = { amount: 'Amount', 'self-expense': 'Self Expense', metal: 'Metal to Metal' };

export function TransactionForm({ kind, entry, busy, balances, save, cancel }: {
  kind: TransactionKind; entry?: TransactionEntry; busy: boolean; balances: Record<Metal, number>;
  save: (input: TransactionInput) => void; cancel: () => void;
}) {
  const purchase = kind === 'purchases';
  const [type, setType] = useState<PaymentType>(entry?.type || 'amount');
  const [metal, setMetal] = useState<Metal>(entry?.metal || 'gold');
  const [numbers, setNumbers] = useState({ weight: String(entry?.weight || ''), rate: String(entry?.rate || ''), purity: String(entry?.purity || ''), amount: String(entry?.amount || '') });
  const weight = Number(numbers.weight) || 0, rate = Number(numbers.rate) || 0, purity = Number(numbers.purity) || 0;
  const isMetal = purchase || type === 'metal';
  const numeric = (name: 'weight' | 'rate' | 'purity' | 'amount', label: string, step: string) => <div className="field">
    <label htmlFor={kind + '-' + name}>{label} *</label>
    <input id={kind + '-' + name} name={name} type="number" step={step} min={step} max={name === 'purity' ? 100 : undefined} aria-required="true" placeholder={step === '0.001' ? '0.000' : '0.00'} value={numbers[name]} onInput={event => { const value = event.currentTarget.value; setNumbers(previous => ({ ...previous, [name]: value })); }} />
  </div>;
  return <div className="panel"><h3><span className="dot" />{entry ? 'Edit ' : 'Add '}{purchase ? 'Old Metal Purchase' : 'Payment'}</h3>
    <form noValidate onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      save({ type, metal, weight: Number(form.get('weight')), rate: Number(form.get('rate')), purity: Number(form.get('purity')), amount: Number(form.get('amount')), reason: String(form.get('reason') || '').trim() });
    }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {!purchase && <><div className="row row-2"><div className="field"><label>Payment type *</label>
          <Select label="Payment type" value={paymentLabels[type]} options={Object.values(paymentLabels)} disabled={busy} onChange={value => setType((Object.keys(paymentLabels) as PaymentType[]).find(key => paymentLabels[key] === value)!)} />
        </div>{!isMetal && numeric('amount', type === 'self-expense' ? 'Self expense amount (₹)' : 'Amount paid (₹)', '0.01')}</div>
        <div className="field"><label htmlFor="payment-reason">Reason (optional)</label><input id="payment-reason" name="reason" defaultValue={entry?.reason || ''} placeholder="e.g. Shop electricity, supplier payment" /></div></>}
        {isMetal && <><div className="row row-3"><div className="field"><label>Metal *</label>
          <Select label="Metal" value={metal === 'gold' ? 'Gold' : 'Silver'} options={['Gold', 'Silver']} disabled={busy} onChange={value => setMetal(value === 'Gold' ? 'gold' : 'silver')} />
        </div>{numeric('weight', purchase ? 'Weight (g)' : 'Gross weight (g)', '0.001')}
        {purchase ? numeric('rate', 'Rate per gram (₹)', '0.01') : numeric('purity', 'Purity (%)', '0.01')}</div>
        <div className="field"><label>{purchase ? 'Calculated amount (₹)' : 'Fine metal weight (g)'}</label><output className="payment-balance" aria-live="polite">{purchase ? money(Math.max(0, weight) * Math.max(0, rate)) : grams(Math.max(0, weight) * Math.min(100, Math.max(0, purity)) / 100)}</output></div>
        {!purchase && <p className="sub">Current old {metal} balance: {grams(balances[metal])}. Gross weight is deducted; fine weight is calculated from purity.</p>}</>}
        <div className="btn-row"><button className="btn btn-gold" type="submit">{busy ? 'Saving…' : entry ? 'Save Changes' : purchase ? 'Save Purchase' : 'Save Payment'}</button>{entry && <button className="btn btn-ghost" type="button" onClick={cancel}>Cancel</button>}</div>
      </fieldset>
    </form>
  </div>;
}
