import { useState, type FormEvent } from 'react';
import { Select } from '../components/Select';
import type { Purity, StockEditor, StockInput } from '../types';

export const purities: readonly Purity[] = ['24K', '22K', '18K', '14K', 'Silver', 'Fine Gold'];

export function StockForm({ editor, initialPurity, busy, save, cancel }: {
  editor: StockEditor; initialPurity: Purity; busy: boolean;
  save: (input: StockInput) => void; cancel: () => void;
}) {
  const [purity, setPurity] = useState<Purity>(editor.mode === 'add' ? initialPurity : editor.item.purity);
  const existing = editor.mode === 'edit' ? editor.item : null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save({ item: String(form.get('item') || '').trim(), purity, qty: Number(form.get('qty')), gross: Number(form.get('gross')), net: Number(form.get('net')) });
  }
  return <div className="panel" style={{ marginBottom: 20 }}>
    <h3><span className="dot" />{editor.mode === 'edit' ? 'Edit Stock Item' : editor.mode === 'batch' ? 'Add Batch to ' + editor.item.item : 'Add Stock Item'}</h3>
    <form data-permission={editor.mode === 'edit' || editor.mode === 'batch' ? 'stocks.edit' : 'stocks.create'} onSubmit={submit} noValidate>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="row row-3">
          <div className="field"><label htmlFor="stock-name">Item (Gold / Silver / Fine Gold) *</label><input id="stock-name" name="item" type="text" required placeholder="e.g. Gold Ring or Silver Chain" defaultValue={editor.mode === 'add' ? '' : editor.item.item} readOnly={editor.mode === 'batch'} /></div>
          <div className="field"><label>Purity / category *</label><Select label="Purity" value={purity} options={purities} onChange={value => setPurity(value as Purity)} disabled={busy || editor.mode === 'batch'} /></div>
          <div className="field"><label htmlFor="stock-qty">Quantity added (pcs) *</label><input type="number" id="stock-qty" name="qty" min="1" step="1" required defaultValue={existing?.qty ?? 1} /></div>
        </div>
        <div className="row row-2">
          <div className="field"><label htmlFor="stock-gross">Total gross weight for quantity (g) *</label><input type="number" id="stock-gross" name="gross" min="0.001" step="0.001" required placeholder="0.000" defaultValue={existing?.gross ?? ''} /></div>
          <div className="field"><label htmlFor="stock-net">Total net weight for quantity (g) *</label><input type="number" id="stock-net" name="net" min="0.001" step="0.001" required placeholder="0.000" defaultValue={existing?.net ?? ''} /></div>
        </div>
        <div className="btn-row">
          <button type="submit" className="btn btn-gold">{busy ? 'Saving…' : editor.mode === 'edit' ? 'Save Changes' : editor.mode === 'batch' ? '＋ Add Batch' : '＋ Add to Stock'}</button>
          {editor.mode !== 'add' && <button type="button" className="btn btn-ghost" onClick={cancel}>Cancel Edit</button>}
        </div>
      </fieldset>
    </form>
  </div>;
}
