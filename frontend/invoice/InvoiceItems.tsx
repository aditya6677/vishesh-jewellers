import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Select } from '../components/Select';
import { money } from '../components/Metric';
import { InvoiceStockPicker } from './InvoiceStockPicker';
import type { InvoiceItemField, InvoiceItemRow, InvoiceItemsSnapshot } from './item-types';

export function InvoiceItems() {
  const [snapshot, setSnapshot] = useState<InvoiceItemsSnapshot>(() => window.vjInvoiceItems?.read() || { items: [], stock: [], pending: false });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const sync = () => { const value = window.vjInvoiceItems?.read(); if (value) setSnapshot(value); };
    const start = () => setBusy(true);
    const end = () => setBusy(false);
    window.addEventListener('vj:invoice-items-sync', sync);
    window.addEventListener('vj:invoice-save-start', start);
    window.addEventListener('vj:invoice-save-end', end);
    sync();
    return () => {
      window.removeEventListener('vj:invoice-items-sync', sync);
      window.removeEventListener('vj:invoice-save-start', start);
      window.removeEventListener('vj:invoice-save-end', end);
    };
  }, []);

  const edit = (row: InvoiceItemRow, field: InvoiceItemField, value: string) => window.vjInvoiceItems?.update(row.id, field, value);
  const number = (row: InvoiceItemRow, field: 'gross' | 'net' | 'pcs' | 'rate' | 'making', label: string, rowNumber: number) => <input
    type="number" className={'f-' + field} aria-label={`${label} item ${rowNumber}`} value={row[field]}
    min={field === 'pcs' ? '1' : field === 'rate' ? '0.01' : field === 'making' ? undefined : '0.001'}
    step={field === 'pcs' ? '1' : field === 'gross' || field === 'net' ? '0.001' : '0.01'}
    placeholder={field === 'gross' || field === 'net' ? '0.000' : '0.00'} required={field !== 'making'} disabled={busy}
    style={field === 'pcs' ? { width: 56 } : field === 'making' ? { width: 60 } : undefined}
    title={field === 'rate' ? 'Editable; prefilled from the live IBJA benchmark when available' : undefined}
    onChange={event => edit(row, field, event.currentTarget.value)}
    onBlur={() => { if (field === 'pcs') window.vjInvoiceItems?.commitQuantity(row.id); }} />;
  const addTarget = document.getElementById('react-invoice-add-item');

  return <>
    {snapshot.items.map((row, index) => <tr key={row.id} data-id={row.id}>
      <td className="name-cell"><input type="text" className="f-name" list="itemNamesList" value={row.name}
        aria-label={`Item name ${index + 1}`} placeholder={snapshot.pending ? 'Item name' : 'Select from stock'} readOnly={!snapshot.pending} disabled={busy}
        onChange={event => edit(row, 'name', event.currentTarget.value)} /></td>
      <td style={{ minWidth: 180 }}><InvoiceStockPicker stocks={snapshot.stock} available={row.available} selectedId={row.stockId} rowNumber={index + 1}
        onSelect={id => { void window.vjInvoiceItems?.selectStock(row.id, id); }} disabled={busy} required={!snapshot.pending} /></td>
      <td><input type="text" className="f-hsn" value={row.hsn} aria-label={`HSN item ${index + 1}`} style={{ width: 56 }} readOnly disabled={busy} /></td>
      <td><input type="hidden" className="f-purity" value={row.purity} /><Select label={`Purity item ${index + 1}`} value={row.purity}
        options={['24K', '22K', '18K', '14K', 'Silver', 'Fine Gold']} onChange={value => edit(row, 'purity', value)} disabled={busy || Boolean(row.stockId)} compact /></td>
      <td>{number(row, 'gross', 'Gross weight', index + 1)}</td>
      <td>{number(row, 'net', 'Net weight', index + 1)}</td>
      <td>{number(row, 'pcs', 'Quantity', index + 1)}</td>
      <td>{number(row, 'rate', 'Rate per gram', index + 1)}</td>
      <td>{number(row, 'making', 'Making percentage', index + 1)}</td>
      <td className="amount-cell">{money(row.amount)}</td>
      <td><button type="button" className="rm-row" disabled={busy} aria-label={`Remove invoice item ${index + 1}`} onClick={() => window.vjInvoiceItems?.remove(row.id)}>×</button></td>
    </tr>)}
    {addTarget && createPortal(<button type="button" className="btn btn-ghost btn-sm" id="addItemRow" disabled={busy} onClick={() => window.vjInvoiceItems?.add()}>+ Add Item Row</button>, addTarget)}
  </>;
}
