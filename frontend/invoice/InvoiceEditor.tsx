import { useEffect, useRef, useState } from 'react';
import { recordsApi, stockApi } from '../api';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import { money } from '../transactions/TransactionForm';
import { InvoiceStockPicker } from './InvoiceStockPicker';
import { editDraft, editStocks, editSummary, type EditDraft, type EditableRecord, type EditLine } from './editor-model';
import { editedInvoiceMarkup } from './editor-paper';
import type { StockItem } from '../types';

interface EditorSession { record: EditableRecord; version: string; stocks: StockItem[] }

export function InvoiceEditor() {
  const [session, setSession] = useState<EditorSession>();
  const [message, setMessage] = useState<{ title: string; text: string }>();
  const saving = useRef(false);
  useEffect(() => {
    let generation = 0;
    window.vjInvoiceEditOpen = async (number, version) => {
      if (saving.current) return;
      const current = ++generation;
      try {
        const [saved, stocks] = await Promise.all([recordsApi.get(number, version), stockApi.list(AbortSignal.timeout(20000))]);
        if (window.vjDatabaseMode) {
          const record = saved.record as EditableRecord;
          const missing = [...new Set([...(record.soldItems || []), ...(record.orderItems || [])].map(item => item.stockId).filter(id => id && !stocks.items.some(stock => stock.id === id)))];
          for (let offset = 0; offset < missing.length; offset += 10) await Promise.all(missing.slice(offset, offset + 10).map(async id => {
            const response = await fetch('/api/stocks/' + encodeURIComponent(id), { signal: AbortSignal.timeout(20000) });
            if (response.status === 404) return;
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not load invoice stock.');
            stocks.items.push(result.item);
          }));
        }
        if (current !== generation) return;
        if (saved.record.status === 'voided') throw new Error('Voided invoices cannot be edited.');
        setSession({ record: saved.record, version: saved.version, stocks: editStocks(saved.record, stocks.items) });
      } catch (error) { if (current === generation) setMessage({ title: 'Could not open invoice', text: (error as Error).message }); }
    };
    return () => { generation++; };
  }, []);
  return <>
    {session && <InvoiceEditDialog key={session.record.number + session.version} session={session} close={() => setSession(undefined)}
      setSaving={value => { saving.current = value; }} done={() => {
        setSession(undefined);
        for (const event of ['vj:records-refresh', 'vj:record-stock-refresh', 'vj:transactions-updated']) window.dispatchEvent(new Event(event));
      }} />}
    {message && <Dialog title={message.title} onClose={() => setMessage(undefined)}><p>{message.text}</p></Dialog>}
  </>;
}

function InvoiceEditDialog({ session, close, done, setSaving }: { session: EditorSession; close: () => void; done: () => void; setSaving: (value: boolean) => void }) {
  const { record } = session;
  const [stocks, setStocks] = useState(session.stocks);
  const [draft, setDraft] = useState<EditDraft>(() => {
    const value = editDraft(record);
    if (!value.terms && record.invoiceMarkup) value.terms = new DOMParser().parseFromString(record.invoiceMarkup, 'text/html').querySelector('#p-terms')?.textContent || '';
    return value;
  });
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => { dialog?.showModal(); return () => dialog?.close(); }, [dialog]);
  const summary = editSummary(record, draft);
  const change = (next: Partial<EditDraft>) => setDraft(current => ({ ...current, ...next }));
  const itemChange = (id: string, next: Partial<EditLine>) => setDraft(current => ({ ...current, items: current.items.map(item => item.lineId === id ? { ...item, ...next } : item) }));
  const available = Object.fromEntries(stocks.map(stock => [stock.id, stock.qty]));
  async function save() {
    if (lock.current) return;
    if (!draft.customer.trim() || !draft.invoiceDate) { setError('Customer name and invoice date are required.'); return; }
    if (!draft.items.length || draft.items.some(item => !item.stockId || !(Number(item.gross) > 0) || !(Number(item.net) > 0) || !(Number(item.rate) > 0) || !Number.isSafeInteger(Number(item.pcs)) || Number(item.pcs) < 1)) {
      setError('Select a stock item and enter quantity, gross weight, net weight, and rate for every item row.'); return;
    }
    lock.current = true; setBusy(true); setSaving(true);
    try {
      await recordsApi.edit(record.number, { ...draft, version: session.version,
        manualDiscount: draft.manualDiscount === '' ? 0 : draft.manualDiscount, paid: draft.paid === '' ? 0 : draft.paid,
        expectedTotal: summary.grand, invoiceMarkup: editedInvoiceMarkup(record, draft) });
      done();
    } catch (error) { setError((error as Error).message); }
    finally { lock.current = false; setBusy(false); setSaving(false); }
  }
  return <>
    <dialog ref={setDialog} className="modal react-dialog invoice-edit-dialog" aria-label={'Edit Invoice ' + record.number} onCancel={event => { event.preventDefault(); if (!lock.current) close(); }}>
      <form noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="toolbar"><h3 style={{ margin: 0 }}>Edit Invoice · {record.number}</h3><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={close}>Close</button></div>
        <p className="void-modal-note">Update this active invoice completely. Weights are totals for the line; PCS only affects stock quantity. Saving recalculates totals and safely reconciles stock and exchanged metal.</p>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="form-grid">
            <div className="field"><label htmlFor="edit-invoice-date">Invoice date *</label><input id="edit-invoice-date" type="date" required value={draft.invoiceDate} onInput={event => change({ invoiceDate: event.currentTarget.value })} onChange={event => change({ invoiceDate: event.currentTarget.value })} /></div>
            <div className="field"><label htmlFor="edit-invoice-customer">Customer name *</label><input id="edit-invoice-customer" type="text" required value={draft.customer} onChange={event => change({ customer: event.currentTarget.value })} /></div>
            <div className="field"><label htmlFor="edit-invoice-mobile">Mobile number</label><input id="edit-invoice-mobile" type="tel" value={draft.mobile} onChange={event => change({ mobile: event.currentTarget.value })} /></div>
            <div className="field"><label htmlFor="edit-invoice-address">Address</label><input type="text" id="edit-invoice-address" value={draft.address} onChange={event => change({ address: event.currentTarget.value })} /></div>
          </div>
          <div className="field" style={{ marginTop: 14 }}><label htmlFor="edit-invoice-terms">Terms &amp; conditions</label><textarea id="edit-invoice-terms" style={{ minHeight: 70 }} value={draft.terms} onChange={event => change({ terms: event.currentTarget.value })} /></div>
          <div className="toolbar" style={{ marginTop: 20 }}><h4>Items</h4><button type="button" className="btn btn-ghost btn-sm" onClick={() => change({ items: [...draft.items, { lineId: crypto.randomUUID(), stockId: '', name: '', purity: '', hsn: '', gross: '', net: '', pcs: 1, rate: '', making: 0 }] })}>+ Add item</button></div>
          <div className="items-table-wrap"><table className="itable"><thead><tr>{['From stock', 'Item', 'Purity', 'Gross Wt (g) · total', 'Net Wt (g) · total', 'Pcs', 'Rate (₹/g)', 'Making %', 'Amount', ''].map((label, index) => <th key={index}>{label}</th>)}</tr></thead><tbody>
            {draft.items.map((item, index) => <tr key={item.lineId}>
              <td><InvoiceStockPicker stocks={stocks} available={available} selectedId={item.stockId} rowNumber={index + 1} disabled={busy} required portalTarget={dialog || undefined} onSelect={(id, remote) => { const stock = remote || stocks.find(stock => stock.id === id); if (!stock) return; setStocks(current => current.some(row => row.id === id) ? current : [...current, stock]); itemChange(item.lineId, { stockId: id, name: stock.item, purity: stock.purity }); }} /></td>
              <td>{item.name || '—'}</td><td>{item.purity || '—'}</td>
              {(['gross', 'net', 'pcs', 'rate', 'making'] as const).map(field => <td key={field}><input type="number" aria-label={`${({ gross: 'Gross weight', net: 'Net weight', pcs: 'Quantity', rate: 'Rate per gram', making: 'Making percentage' })[field]} edit item ${index + 1}`} min={field === 'pcs' ? 1 : 0} step={field === 'pcs' ? 1 : field === 'gross' || field === 'net' ? 0.001 : 0.01} required={field !== 'making'} value={item[field]} onChange={event => itemChange(item.lineId, { [field]: event.currentTarget.value })} /></td>)}
              <td>{money(window.vjInvoiceEditMath.totals([item], 0, 0).subtotal)}</td><td><button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove edit item ${index + 1}`} onClick={() => change({ items: draft.items.filter(entry => entry.lineId !== item.lineId) })}>×</button></td>
            </tr>)}
          </tbody></table>{!draft.items.length && <p>Add at least one stock item.</p>}</div>
          <div className="toolbar" style={{ marginTop: 20 }}><h4>Gold / Silver Exchange</h4><button type="button" className="btn btn-ghost btn-sm" onClick={() => change({ exchanges: [...draft.exchanges, { id: crypto.randomUUID(), metal: 'gold', weight: '', rate: '', required: true }] })}>+ Add exchange item</button></div>
          <div className="exchange-rows">{draft.exchanges.map((entry, index) => {
            const update = (next: Partial<typeof entry>) => change({ exchanges: draft.exchanges.map(current => current.id === entry.id ? { ...current, ...next } : current) });
            return <div className="exchange-row" key={entry.id}>
              <div className="field"><label>Metal *</label><Select label={`Edit exchange metal ${index + 1}`} value={entry.metal === 'gold' ? 'Gold' : 'Silver'} options={['Gold', 'Silver']} disabled={busy} portalTarget={dialog || undefined} onChange={value => update({ metal: value === 'Gold' ? 'gold' : 'silver' })} /></div>
              {(['weight', 'rate'] as const).map(field => <div className="field" key={field}><label htmlFor={`edit-exchange-${field}-${entry.id}`}>{field === 'weight' ? 'Weight (g) *' : 'Rate / gram (₹) *'}</label><input id={`edit-exchange-${field}-${entry.id}`} type="number" aria-label={`Edit exchange ${field} ${index + 1}`} min="0" step={field === 'weight' ? 0.001 : 0.01} value={entry[field]} onChange={event => update({ [field]: event.currentTarget.value })} /></div>)}
              <div className="field"><label>Value</label><output className="exchange-row-value">{money((Number(entry.weight) || 0) * (Number(entry.rate) || 0))}</output></div><button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove edit exchange ${index + 1}`} onClick={() => change({ exchanges: draft.exchanges.filter(current => current.id !== entry.id) })}>×</button>
            </div>;
          })}{!draft.exchanges.length && <p className="sub">No exchange items added.</p>}</div>
          <div className="form-grid" style={{ marginTop: 18 }}>
            <div className="field"><label htmlFor="edit-invoice-discount">Manual discount (₹)</label><input id="edit-invoice-discount" type="number" min="0" step="0.01" value={draft.manualDiscount} onChange={event => change({ manualDiscount: event.currentTarget.value })} /></div>
            <div className="field"><label>GST rate</label><Select label="Edit invoice GST rate" value={draft.gstRate === '0' ? 'Non-GST Invoice — No GST charged' : 'GST Invoice — 3%'} options={['GST Invoice — 3%', 'Non-GST Invoice — No GST charged']} disabled={busy} portalTarget={dialog || undefined} onChange={value => change({ gstRate: value.startsWith('Non-GST') ? '0' : '3' })} /></div>
            <div className="field"><label htmlFor="edit-invoice-paid">Amount paid at invoice (₹)</label><input id="edit-invoice-paid" type="number" min="0" step="0.01" value={draft.paid} onChange={event => change({ paid: event.currentTarget.value })} /></div>
            <div className="field"><label>Revised total</label><output className="payment-balance">{money(summary.grand)}</output></div>
          </div>
          <div className="record-info-grid" style={{ marginTop: 14 }}><div className="record-info"><b>Items subtotal</b>{money(summary.subtotal)}</div><div className="record-info"><b>Exchange credit</b>{money(summary.exchange)}</div><div className="record-info"><b>{summary.advance > 0 ? 'Plus amount' : 'Amount due'}</b><span className={summary.advance > 0 ? 'plus-amount' : 'due-amount'}>{money(summary.advance || summary.due)}</span></div></div>
          <div className="btn-row" style={{ marginTop: 20 }}><button type="submit" className="btn btn-gold">{busy ? 'Saving…' : 'Save Revised Invoice'}</button><button type="button" className="btn btn-ghost" onClick={close}>Cancel</button></div>
        </fieldset>
      </form>
    </dialog>
    {error && <Dialog title="Could not save invoice" onClose={() => setError('')}><p>{error}</p></Dialog>}
  </>;
}
