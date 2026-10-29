import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, transactionApi } from '../api';
import { Dialog } from '../components/Dialog';
import { Pagination } from '../components/Pagination';
import { usePageSize } from '../workspace/preferences';
import { TransactionForm, grams, money, paymentLabels } from './TransactionForm';
import type { TransactionEntry, TransactionInput, TransactionKind, TransactionSnapshot } from '../types';

export function Transactions({ kind }: { kind: TransactionKind }) {
  const purchase = kind === 'purchases';
  const title = purchase ? 'Purchase' : 'Payment';
  const [data, setData] = useState<TransactionSnapshot>({ items: [], versions: {}, balances: { gold: 0, silver: 0 } });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ item: TransactionEntry; version: string }>();
  const [deleting, setDeleting] = useState<{ item: TransactionEntry; version: string }>();
  const [reset, setReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ title: string; text: string }>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(kind);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const lock = useRef(false);
  const formTop = useRef<HTMLDivElement>(null);
  const reload = useCallback(async () => {
    const revision = ++generation.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await transactionApi.list(kind, controller.signal, page, pageSize);
      if (revision === generation.current) { setData(result); setLoaded(true); setError(''); }
    } catch (error) { if (!controller.signal.aborted && revision === generation.current) setError((error as Error).message); }
  }, [kind, page, pageSize]);
  useEffect(() => {
    void reload();
    const refresh = () => { void reload(); };
    window.addEventListener('vj:' + kind + '-refresh', refresh);
    window.addEventListener('vj:transactions-updated', refresh);
    return () => { request.current?.abort(); window.removeEventListener('vj:' + kind + '-refresh', refresh); window.removeEventListener('vj:transactions-updated', refresh); };
  }, [kind, reload]);
  const resetForm = () => { setEditor(undefined); setReset(value => value + 1); };
  async function mutate(input?: TransactionInput) {
    if (lock.current || (!input && !deleting)) return;
    lock.current = true; setBusy(true);
    try {
      const result = input ? await transactionApi.save(kind, input, editor?.item.id, editor?.version) : await transactionApi.remove(kind, deleting!.item.id, deleting!.version);
      ++generation.current; request.current?.abort(); setData(result); setLoaded(true); setError('');
      if (result.refreshRequired) void reload();
      if (input || editor?.item.id === deleting?.item.id) resetForm();
      setDeleting(undefined);
      setMessage({ title: title + (input ? ' saved' : ' deleted'), text: 'The record and linked old-metal balance have been updated together.' });
      window.dispatchEvent(new Event('vj:transactions-updated'));
    } catch (error) {
      setDeleting(undefined);
      setMessage({ title: 'Could not ' + (input ? 'save ' : 'delete ') + title.toLowerCase(), text: error instanceof ApiError ? error.message : 'The result could not be confirmed. Refresh before trying again.' });
      void reload();
    } finally { lock.current = false; setBusy(false); }
  }
  const metalWeight = (metal: 'gold' | 'silver') => data.summary?.[metal] ?? data.items.filter(item => item.metal === metal && (purchase || item.type === 'metal')).reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  const amount = data.summary?.amount ?? data.items.filter(item => purchase || item.type !== 'metal').reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const cards = purchase ? [['Gold Purchased', grams(metalWeight('gold'))], ['Silver Purchased', grams(metalWeight('silver'))], ['Total Purchase Value', money(amount)]] : [['Cash Outflow', money(amount)], ['Gold Used', grams(metalWeight('gold'))], ['Silver Used', grams(metalWeight('silver'))]];
  const rowCount = data.pagination?.total ?? data.items.length;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rowCount / pageSize)));
  return <>
    <div className="page-head"><p className="eyebrow">{purchase ? 'Old metal register' : 'Outgoing payments'}</p><h2>{title}</h2><p className="sub">{purchase ? 'Record old gold and silver purchases separately from fresh stock.' : 'Record cash payments, self expenses, or metal-to-metal payments from your old Gold and Silver balance.'}</p></div>
    <div className="stat-cards">{cards.map(([label, value]) => <div className="stat-card" key={label}><div className="lbl">{label}</div><div className="val">{value}</div></div>)}</div>
    {error && <p role="alert" className="due-amount">{error}</p>}
    <div ref={formTop}><TransactionForm key={reset} kind={kind} entry={editor?.item} balances={data.balances} busy={busy || !loaded} save={input => { void mutate(input); }} cancel={resetForm} /></div>
    <div className="panel"><div className="toolbar"><h3><span className="dot" />{title} History</h3><span>{data.items.length} {title.toLowerCase()}s</span><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void reload(); }}>Refresh {title}s</button></div>
      {!loaded ? <p role="status">Loading…</p> : <><div className="data-table-wrap"><table className="data-table"><thead><tr>{(purchase ? ['Date', 'Metal', 'Weight', 'Rate / g', 'Amount', 'Actions'] : ['Date', 'Type / Reason', 'Metal', 'Gross Wt', 'Purity', 'Fine Wt', 'Amount', 'Actions']).map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{(data.pagination ? data.items : data.items.slice((currentPage - 1) * pageSize, currentPage * pageSize)).map(item => <tr key={item.id}>
          <td>{new Date(item.savedAt).toLocaleDateString('en-GB')}</td>
          {!purchase && <td>{item.type ? paymentLabels[item.type] : '—'}{item.reason && <><br /><small>{item.reason}</small></>}</td>}
          <td>{item.metal === 'gold' ? 'Gold' : item.metal === 'silver' ? 'Silver' : '—'}</td><td>{purchase || item.type === 'metal' ? grams(item.weight) : '—'}</td>
          {purchase ? <td>{money(item.rate)}</td> : <><td>{item.type === 'metal' ? Number(item.purity).toFixed(2) + '%' : '—'}</td><td className="paid-amount">{item.type === 'metal' ? grams(item.fineWeight) : '—'}</td></>}
          <td>{item.type === 'metal' ? '—' : money(item.amount)}</td><td className="actions-cell"><button data-permission={kind + '.edit'} className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setEditor({ item, version: data.versions[item.id] }); setReset(value => value + 1); formTop.current?.scrollIntoView({ behavior: 'smooth' }); }}>Edit</button> <button data-permission={kind + '.delete'} className="btn btn-danger btn-sm" disabled={busy} onClick={() => setDeleting({ item, version: data.versions[item.id] })}>Delete</button></td>
        </tr>)}</tbody></table></div><Pagination total={rowCount} page={currentPage} pageSize={pageSize} setPage={setPage} setPageSize={value => { setPageSize(value); setPage(1); }} />{!data.items.length && <div className="empty-state">No {title.toLowerCase()}s recorded yet.</div>}</>}
    </div>
    {deleting && <Dialog title={'Delete ' + title} danger busy={busy} onClose={() => setDeleting(undefined)} onConfirm={() => { void mutate(); }}><p>Delete this {title.toLowerCase()} from {new Date(deleting.item.savedAt).toLocaleDateString('en-GB')}? This permanently removes the entry and reverses its linked old-metal balance.</p></Dialog>}
    {message && <Dialog title={message.title} onClose={() => setMessage(undefined)}><p>{message.text}</p></Dialog>}
  </>;
}
