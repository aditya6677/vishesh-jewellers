import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, stockApi } from '../api';
import { StockForm } from '../stocks/StockForm';
import type { StockInput, StockItem } from '../types';

export function AddInvoiceStock({ name, onClose, onCreated }: {
  name: string; onClose: () => void; onCreated: (stock: StockItem) => void;
}) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const id = useId();
  useEffect(() => { dialog?.showModal(); return () => dialog?.close(); }, [dialog]);
  async function save(input: StockInput) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await stockApi.create(input);
      // SQLite returns the affected row; JSON appends the created row. Never
      // identify stock by its name, which is not unique.
      const created = result.affected?.[0] || result.items.at(-1);
      if (!created) throw new Error('Stock saved, but its selection could not be confirmed. Refresh stock before trying again.');
      window.dispatchEvent(new CustomEvent('vj:stock-cache-merge', { detail: [created] }));
      window.dispatchEvent(new Event('vj:stocks-refresh'));
      onCreated(created);
    } catch (error) {
      setError(error instanceof ApiError ? error.message : 'The save could not be confirmed. Check Stocks before trying again.');
    } finally { lock.current = false; setBusy(false); }
  }
  return createPortal(<dialog ref={setDialog} className="modal react-dialog invoice-add-stock-dialog" aria-label="Add stock for invoice"
    onCancel={event => { event.preventDefault(); if (!lock.current) onClose(); }}>
    <div className="toolbar"><h3>Add stock for invoice</h3><button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>Cancel</button></div>
    <p className="invoice-add-stock-note">Add inventory here without leaving your invoice. Weights are totals for the quantity added.</p>
    {error && <p className="invoice-add-stock-error" role="alert">{error}</p>}
    <StockForm editor={{ mode: 'add' }} initialPurity="22K" initialName={name} idPrefix={id} busy={busy} save={save} cancel={onClose} portalTarget={dialog || undefined} />
  </dialog>, document.body);
}
