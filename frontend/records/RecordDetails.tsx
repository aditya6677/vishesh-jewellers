import { useState } from 'react';
import { Select } from '../components/Select';
import { money, grams } from '../transactions/TransactionForm';
import type { InvoiceRecord, SettlementInput } from '../types';

export const netTotal = (record: InvoiceRecord) => Math.max((Number(String(record.total || '').replace(/[^0-9.-]/g, '')) || 0) - (Number(record.returnTotal) || 0), 0);
export const balance = (record: InvoiceRecord) => {
  const due = Number(record.due) || 0;
  const advance = due <= 0 ? Math.max((Number(record.paid) || 0) - netTotal(record), 0) : 0;
  return { label: advance > 0 ? 'Plus amount' : 'Amount due', text: (advance > 0 ? '+' : '') + money(advance || Math.max(due, 0)), className: advance > 0 ? 'plus-amount' : due > 0 ? 'due-amount' : 'paid-amount' };
};

export function RecordDetails({ record, busy, settle, action, confirm }: {
  record: InvoiceRecord; busy: boolean; settle: (input: SettlementInput) => void;
  action: (action: 'view' | 'edit' | 'void') => void; confirm: (action: 'paid' | 'delete') => void;
}) {
  const [method, setMethod] = useState('Amount / Cash');
  const [weight, setWeight] = useState('');
  const [rate, setRate] = useState('');
  const [amount, setAmount] = useState('');
  const item = method !== 'Amount / Cash';
  const voided = record.status === 'voided', pending = record.status === 'pending';
  const due = Number(record.due) || 0, remaining = balance(record);
  const exchanges = record.exchanges || (record.exchange ? [record.exchange] : []);
  return <div className="record-detail-card">
    <div className="record-info-grid">
      <div className="record-info"><b>Customer address</b>{record.address || '—'}</div>
      <div className="record-info"><b>{pending ? 'Ordered items' : 'Items'}</b>{record.items || '—'}</div>
      <div className="record-info"><b>Old metal exchange</b>{exchanges.length ? exchanges.map((entry, index) => <div key={index}>{entry.metal === 'silver' ? 'Silver' : 'Gold'} · {grams(Number(entry.weight) || 0)} × {money(Number(entry.rate) || 0)}/g = {money(Number(entry.value) || 0)}</div>) : 'No old metal exchanged'}</div>
      <div className="record-info"><b>Net invoice total</b><span className="paid-amount">{money(netTotal(record))}</span></div>
      <div className="record-info"><b>Paid</b><span className="paid-amount">{money(Number(record.paid) || 0)}</span></div>
      <div className="record-info"><b>{remaining.label}</b><span className={remaining.className}>{remaining.text}</span></div>
      {voided && <div className="record-info"><b>Void reason</b>{record.voidReason || '—'}</div>}
      {pending && <div className="record-info"><b>Order status</b>Awaiting stock selection and delivery</div>}
      <div className="record-info"><b>Payment / settlement history</b>{record.payments?.length ? record.payments.map((payment, index) => <div key={index}>{payment.method === 'gold' ? 'Gold' : payment.method === 'silver' ? 'Silver' : 'Amount'}{payment.weight ? ' · ' + grams(payment.weight) + ' × ' + money(payment.rate || 0) + '/g' : ''} — {money(payment.amount || 0)}</div>) : 'No settlement recorded'}</div>
    </div>
    {!voided && due > 0 && <form noValidate onSubmit={event => { event.preventDefault(); settle({ method: item ? method === 'Gold item' ? 'gold' : 'silver' : 'amount', amount: Number(amount), weight: Number(weight), rate: Number(rate) }); }}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}><div className="row row-3">
        <div className="field"><label>Settlement type *</label><Select label="Settlement type" value={method} options={['Amount / Cash', 'Gold item', 'Silver item']} disabled={busy} onChange={setMethod} /></div>
        {item ? <><div className="field"><label htmlFor="record-settlement-weight">Weight (g) *</label><input id="record-settlement-weight" type="number" min="0.001" step="0.001" aria-required="true" value={weight} onInput={event => setWeight(event.currentTarget.value)} /></div><div className="field"><label htmlFor="record-settlement-rate">Price per gram (₹) *</label><input id="record-settlement-rate" type="number" min="0.01" step="0.01" aria-required="true" value={rate} onInput={event => setRate(event.currentTarget.value)} /></div><div className="field"><label>Calculated settlement (₹)</label><output className="payment-balance" aria-live="polite">{money(Math.max(0, Number(weight)) * Math.max(0, Number(rate)))}</output></div></> : <div className="field"><label htmlFor="record-settlement-amount">Settle amount (₹) *</label><input id="record-settlement-amount" type="number" min="0.01" step="0.01" max={due} aria-required="true" placeholder="Enter received amount" value={amount} onInput={event => setAmount(event.currentTarget.value)} /></div>}
      </div><div className="btn-row"><button className="btn btn-gold btn-sm" type="submit">{busy ? 'Saving…' : item ? 'Settle ' + (method === 'Gold item' ? 'Gold' : 'Silver') : 'Settle Amount'}</button><button className="btn btn-ghost btn-sm" type="button" onClick={() => confirm('paid')}>Mark Fully Paid</button></div></fieldset>
    </form>}
    <div className="btn-row">
      {!voided && <><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => action('edit')}>{pending ? 'Deliver Order' : 'Edit Invoice'}</button><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => action('void')}>{pending ? 'Cancel Order' : 'Void Invoice'}</button></>}
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => action('view')}>{voided ? 'View Voided Invoice' : pending ? 'View Pending Invoice' : 'Regenerate Invoice'}</button>
      <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => confirm('delete')}>Delete Record</button>
    </div>
  </div>;
}
