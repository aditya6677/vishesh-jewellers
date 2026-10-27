import { useEffect, useState } from 'react';
import { money } from '../components/Metric';
import { Select } from '../components/Select';
import { calculateInvoiceExchange } from '../../lib/invoice-exchange.mjs';

type Metal = 'gold' | 'silver';
type ExchangeRow = { id: number; metal: Metal; weight: string; rate: string; required: boolean };
type ExchangeEntry = { metal: Metal; weight: number; rate: number; value: number };

declare global {
  interface Window { vjInvoiceExchangeEntries?: () => ExchangeEntry[] }
}

const emptyRow = (id: number, required = false): ExchangeRow => ({ id, metal: 'gold', weight: '0', rate: '0', required });

function cleanEntries(rows: ExchangeRow[]): ExchangeEntry[] {
  return rows.map(row => {
    const weight = Math.max(Number(row.weight) || 0, 0);
    const rate = Math.max(Number(row.rate) || 0, 0);
    return { metal: row.metal, weight, rate, value: weight * rate };
  });
}

export function InvoiceExchange() {
  const [rows, setRows] = useState<ExchangeRow[]>([emptyRow(1)]);
  const [nextId, setNextId] = useState(2);
  const total = calculateInvoiceExchange(rows);

  useEffect(() => {
    const entries = cleanEntries(rows);
    window.vjInvoiceExchangeEntries = () => entries;

    const hidden = document.getElementById('exchange-disc') as HTMLInputElement | null;
    if (hidden) {
      const discount = Math.max(Number((document.getElementById('invoice-discount') as HTMLInputElement | null)?.value) || 0, 0);
      hidden.value = (total + discount).toFixed(2);
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, [rows, total]);

  useEffect(() => {
    const reset = () => {
      setRows([emptyRow(1)]);
      setNextId(2);
    };
    window.addEventListener('vj:invoice-exchange-reset', reset);
    return () => window.removeEventListener('vj:invoice-exchange-reset', reset);
  }, []);

  const updateRow = (id: number, update: Partial<ExchangeRow>) => {
    setRows(current => current.map(row => row.id === id ? { ...row, ...update } : row));
  };

  const removeRow = (id: number) => {
    setRows(current => {
      const remaining = current.filter(row => row.id !== id);
      return remaining.length ? remaining : [emptyRow(nextId)];
    });
    if (rows.length === 1) setNextId(value => value + 1);
  };

  const addRow = () => {
    setRows(current => [...current, emptyRow(nextId, true)]);
    setNextId(value => value + 1);
  };

  return <section className="exchange-panel">
    <div className="toolbar"><div className="exchange-panel-title" style={{ margin: 0 }}>Gold / Silver Exchange</div>
      <button className="btn btn-ghost btn-sm" id="addExchangeRow" type="button" onClick={addRow}>+ Add item</button></div>
    <p className="sub" style={{ margin: '0 0 12px' }}>Add each exchanged gold or silver item separately.</p>
    <div className="exchange-rows" id="exchangeRows">{rows.map(row => <div className="exchange-row" data-required={row.required ? 'true' : 'false'} key={row.id}>
      <div className="field"><label>Metal</label><input type="hidden" className="exchange-row-metal" value={row.metal} />
        <Select label={`Exchange metal ${row.id}`} value={row.metal === 'silver' ? 'Silver' : 'Gold'} options={['Gold', 'Silver']}
          onChange={value => updateRow(row.id, { metal: value === 'Silver' ? 'silver' : 'gold' })} /></div>
      <div className="field"><label htmlFor={`exchange-weight-${row.id}`}>{row.required ? 'Weight (g) *' : 'Weight (g)'}</label>
        <input id={`exchange-weight-${row.id}`} className="exchange-row-weight" type="number" value={row.weight} min="0" step="0.001" placeholder="0.000"
          aria-required={row.required} onChange={event => updateRow(row.id, { weight: event.currentTarget.value })} /></div>
      <div className="field"><label htmlFor={`exchange-rate-${row.id}`}>{row.required ? 'Rate / gram (₹) *' : 'Rate / gram (₹)'}</label>
        <input id={`exchange-rate-${row.id}`} className="exchange-row-rate" type="number" value={row.rate} min="0" step="0.01" placeholder="0.00"
          aria-required={row.required} onChange={event => updateRow(row.id, { rate: event.currentTarget.value })} /></div>
      <div className="field"><label>Value</label><div className="exchange-row-value">{money(calculateInvoiceExchange([{ weight: row.weight, rate: row.rate }]))}</div></div>
      <button className="btn btn-ghost btn-sm exchange-remove" type="button" title="Remove item" aria-label="Remove exchange item" onClick={() => removeRow(row.id)}>×</button>
    </div>)}</div>
    <div className="field exchange-total" style={{ marginBottom: 0 }}><label>Total exchange credit (₹)</label>
      <div className="payment-balance" id="exchange-value">{money(total)}</div></div>
  </section>;
}
