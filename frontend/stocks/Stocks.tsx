import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, stockApi } from '../api';
import { Dialog } from '../components/Dialog';
import { Pagination } from '../components/Pagination';
import { usePageSize } from '../workspace/preferences';
import { StockForm } from './StockForm';
import type { Purity, StockEditor, StockInput, StockItem, StockSnapshot } from '../types';

const weight = (value: number) => (Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function Stocks() {
  const [data, setData] = useState<StockSnapshot>({ items: [], versions: {} });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editor, setEditor] = useState<StockEditor>({ mode: 'add' });
  const [reset, setReset] = useState(0);
  const [purity, setPurity] = useState<Purity>('22K');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('stocks');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ title: string; text: string } | null>(null);
  const [deleting, setDeleting] = useState<{ item: StockItem; version: string } | null>(null);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const formTop = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const revision = ++generation.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    try {
      const result = await stockApi.list(request.signal, page, pageSize, search);
      if (revision === generation.current) { setData(result); setLoaded(true); setLoadError(''); }
    } catch (error) {
      if (!request.signal.aborted && revision === generation.current) setLoadError((error as Error).message);
    }
  }, [page, pageSize, search]);

  useEffect(() => {
    void reload();
    const refresh = () => { void reload(); };
    window.addEventListener('vj:stocks-refresh', refresh);
    return () => { controller.current?.abort(); window.removeEventListener('vj:stocks-refresh', refresh); };
  }, [reload]);

  function resetForm() { setEditor({ mode: 'add' }); setReset(value => value + 1); }
  function accept(result: StockSnapshot) {
    if (result.refreshRequired) {
      window.dispatchEvent(new CustomEvent('vj:stock-cache-merge', { detail: result.affected || [] }));
      window.dispatchEvent(new Event('vj:stocks-invalidated'));
      void reload(); return;
    }
    ++generation.current; controller.current?.abort();
    setData(result); setLoaded(true); setLoadError('');
    window.dispatchEvent(new CustomEvent('vj:stocks-updated', { detail: result.items }));
  }
  function select(item: StockItem, mode: 'edit' | 'batch') {
    setEditor({ mode, item, version: data.versions[item.id] }); setPurity(item.purity); setReset(value => value + 1);
    formTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function save(input: StockInput) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = editor.mode === 'add' ? await stockApi.create(input) : editor.mode === 'edit'
        ? await stockApi.edit(editor.item.id, input, editor.version)
        : await stockApi.batch(editor.item.id, input, editor.version);
      accept(result); setPurity(input.purity); resetForm();
      setMessage({ title: 'Stock saved', text: editor.mode === 'add' ? 'Added to stock' : editor.mode === 'edit' ? 'Stock item updated' : `Batch added: +${input.qty} pcs, +${weight(input.gross)} g gross, +${weight(input.net)} g net` });
    } catch (error) {
      setMessage({ title: 'Could not save stock', text: error instanceof ApiError ? error.message : 'The save could not be confirmed. Refresh Stocks before trying again.' });
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) void reload();
    } finally { lock.current = false; setBusy(false); }
  }
  async function remove() {
    if (!deleting || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      accept(await stockApi.remove(deleting.item.id, deleting.version));
      if (editor.mode !== 'add' && editor.item.id === deleting.item.id) resetForm();
      setDeleting(null); setMessage({ title: 'Stock deleted', text: 'Stock item deleted' });
    } catch (error) {
      setDeleting(null);
      setMessage({ title: 'Could not delete stock', text: (error as Error).message });
      void reload();
    } finally { lock.current = false; setBusy(false); }
  }

  const filtered = data.pagination ? data.items : data.items.filter(item => item.item.toLowerCase().includes(search.toLowerCase()));
  const rowCount = data.pagination?.total ?? filtered.length;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rowCount / pageSize)));
  return <>
    <div className="page-head"><p className="eyebrow">Inventory</p><h2>Stocks</h2><p className="sub">Record the item count and total batch weights. Remaining stock is tracked by weight; gross and net weights below cover all pieces in the entered quantity.</p></div>
    <div className="stat-cards">{(['Gold', 'Silver'] as const).map(metal => {
      const items = data.items.filter(item => (item.purity === 'Silver') === (metal === 'Silver'));
      return <div className="stat-card" key={metal}><div className="lbl">{metal} Stock</div><div className="val stock-summary"><div className="stock-weight-pair">
        {(['gross', 'net'] as const).map(field => <div className="stock-weight-item" key={field}><span>{field === 'gross' ? 'Gross' : 'Net'}</span><strong>{weight(data.totals?.[metal === 'Silver' ? 'silver' : 'gold'][field] ?? items.reduce((sum, item) => sum + (Number(item[field]) || 0), 0))} g</strong></div>)}
      </div><small className="stock-entry-count">{data.totals?.[metal === 'Silver' ? 'silver' : 'gold'].count ?? items.length} items</small></div></div>;
    })}</div>
    {loadError && <p role="alert" className="due-amount">{loadError} <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void reload(); }}>Refresh Stocks</button></p>}
    <div ref={formTop}><StockForm key={reset} editor={editor} initialPurity={purity} busy={busy || !loaded} save={input => { void save(input); }} cancel={resetForm} /></div>
    <div className="panel">
      <div className="toolbar"><div className="search-box"><input type="search" aria-label="Search stock by item name" placeholder="Search stock by item name…" value={search} onInput={event => { setSearch(event.currentTarget.value); setPage(1); }} /></div>
        <span className="table-result-count">{rowCount} of {data.total ?? data.items.length} shown</span>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => { void reload(); }} disabled={busy}>Refresh Stocks</button>
      </div>
      {!loaded ? <p role="status">Loading stock…</p> : <>
        <div className="data-table-wrap"><table className="data-table"><thead><tr>{['Item', 'Purity', 'Qty added', 'Total gross wt', 'Total net wt', 'Added', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{(data.pagination ? filtered : filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)).map(item => <tr key={item.id}>
            <td>{item.item}</td><td><span className="pill">{item.purity}</span></td><td>{item.qty}</td><td>{weight(item.gross)} g</td><td>{weight(item.net)} g</td><td>{item.added || '—'}</td>
            <td className="actions-cell"><button data-permission="stocks.edit" type="button" className="btn btn-ghost btn-sm" onClick={() => select(item, 'batch')} disabled={busy}>Add Batch</button> <button data-permission="stocks.edit" type="button" className="btn btn-ghost btn-sm" onClick={() => select(item, 'edit')} disabled={busy}>Edit</button> <button data-permission="stocks.delete" type="button" className="btn btn-danger btn-sm" onClick={() => setDeleting({ item, version: data.versions[item.id] })} disabled={busy}>Delete</button></td>
          </tr>)}</tbody>
        </table></div>
        <Pagination total={rowCount} page={currentPage} pageSize={pageSize} setPage={setPage} setPageSize={value => { setPageSize(value); setPage(1); }} />
        {!filtered.length && <div className="empty-state"><div className="glyph">✦</div>{data.items.length ? 'No matching stock items.' : 'No stock items yet — add your first piece above.'}</div>}
      </>}
    </div>
    {deleting && <Dialog title="Confirm Delete" onClose={() => setDeleting(null)} onConfirm={() => { void remove(); }} danger busy={busy}><p>Delete “{deleting.item.item}” from stock? This action cannot be undone.</p></Dialog>}
    {message && <Dialog title={message.title} onClose={() => setMessage(null)}><p>{message.text}</p></Dialog>}
  </>;
}
