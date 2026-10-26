import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { recordsApi } from '../api';
import { Dialog } from '../components/Dialog';
import { Select } from '../components/Select';
import { Pagination } from '../components/Pagination';
import { money } from '../transactions/TransactionForm';
import { RecordDetails, balance, netTotal } from './RecordDetails';
import type { InvoiceRecord, RecordFilters, RecordsSnapshot, SettlementInput } from '../types';

const statuses: Record<string, string> = { all: 'All records', due: 'Due', advance: 'Advance', pending: 'Pending delivery', settled: 'Settled', voided: 'Voided' };
export function Records() {
  const [filters, setFilters] = useState<RecordFilters>({ query: '', status: 'all', from: '', to: '' });
  const [data, setData] = useState<RecordsSnapshot>({ items: [], total: 0, versions: {} });
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [expanded, setExpanded] = useState<string>();
  const [page, setPage] = useState(1), [size, setSize] = useState(10);
  const [message, setMessage] = useState<{ title: string; text: string }>();
  const [confirmation, setConfirmation] = useState<{ action: 'paid' | 'delete'; record: InvoiceRecord; version: string }>();
  const request = useRef<AbortController | null>(null), lock = useRef(false), generation = useRef(0);
  const reload = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const revision = ++generation.current;
    setLoading(true);
    try {
      const snapshot = await recordsApi.list(filters, controller.signal);
      if (revision === generation.current) { setData(snapshot); setLoaded(true); setError(''); }
    } catch (error) { if (!controller.signal.aborted && revision === generation.current) setError((error as Error).message); }
    finally { if (revision === generation.current) setLoading(false); }
  }, [filters]);
  useEffect(() => {
    void reload(); const refresh = () => { setExpanded(undefined); void reload(); };
    window.addEventListener('vj:records-refresh', refresh);
    return () => { request.current?.abort(); window.removeEventListener('vj:records-refresh', refresh); };
  }, [reload]);
  function change(next: Partial<RecordFilters>) {
    const value = { ...filters, ...next };
    if (value.from && value.to && value.from > value.to) { setMessage({ title: 'Invalid date range', text: 'From date must be on or before To date.' }); return; }
    setFilters(value); setPage(1); setExpanded(undefined);
  }
  async function run(record: InvoiceRecord, action: 'view' | 'edit' | 'void' | 'delete' | 'settle', input?: SettlementInput, version = data.versions[record.number]) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      if (action === 'settle') {
        const result = await recordsApi.settle(record.number, version, input!);
        setExpanded(undefined); await reload();
        window.dispatchEvent(new Event('vj:transactions-updated'));
        setMessage({ title: 'Settlement saved', text: 'Settlement of ' + money(result.settled) + ' saved for ' + record.number + '. Remaining due: ' + money(result.record.due || 0) + '.' });
      } else if (action === 'delete') {
        await recordsApi.remove(record.number); setExpanded(undefined); await reload();
        window.dispatchEvent(new Event('vj:record-stock-refresh')); window.dispatchEvent(new Event('vj:transactions-updated'));
        setMessage({ title: 'Invoice deleted', text: record.number + ' was deleted and its calculations reversed. This cannot be undone from the app.' });
      } else await window.vjRecordAction(action, record.number, version);
    } catch (error) {
      setMessage({ title: 'Action could not be completed', text: (error as Error).message });
      await reload();
    } finally { lock.current = false; setBusy(false); setConfirmation(undefined); }
  }
  const currentPage = Math.min(page, Math.max(1, Math.ceil(data.items.length / size)));
  return <>
    <div className="page-head"><p className="eyebrow">Sales history</p><h2>Invoice Records</h2><p className="sub">Search by customer, mobile number, or invoice number, then export the matching invoice details as a PDF.</p></div>
    <div className="panel"><div className="toolbar react-record-toolbar">
      <div className="search-box"><input type="text" aria-label="Search invoices" placeholder="Search invoice number, customer, or mobile…" value={filters.query} disabled={busy} onInput={event => change({ query: event.currentTarget.value })} /></div>
      <Select label="Filter invoices by status" value={statuses[filters.status]} options={Object.values(statuses)} disabled={busy} onChange={label => change({ status: Object.keys(statuses).find(key => statuses[key] === label)! })} />
      <button className="btn btn-ghost btn-sm" disabled={busy || loading || Boolean(error)} onClick={async () => { if (lock.current) return; lock.current = true; setBusy(true); try { await window.vjRecordExport(filters); } catch (error) { setMessage({ title: 'Export failed', text: (error as Error).message }); } finally { lock.current = false; setBusy(false); } }}>↓ Export PDF</button>
      <span>{data.items.length} of {data.total} shown</span><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setExpanded(undefined); void reload(); }}>Refresh Records</button>
    </div>
    <div className="records-range"><div className="range-date"><label htmlFor="react-record-from">From</label><input id="react-record-from" type="date" aria-label="Start invoice date" value={filters.from} max={filters.to || undefined} disabled={busy} onChange={event => change({ from: event.currentTarget.value })} /></div><div className="range-date"><label htmlFor="react-record-to">To</label><input id="react-record-to" type="date" aria-label="End invoice date" value={filters.to} min={filters.from || undefined} disabled={busy} onChange={event => change({ to: event.currentTarget.value })} /></div><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => change({ from: '', to: '' })}>Clear dates</button><span className="range-caption">Filters by invoice date</span></div>
    {error && <p role="alert" className="due-amount">{error}</p>}{loading && <p role="status">Loading records…</p>}
    <div className="data-table-wrap"><table className="data-table"><thead><tr>{['Invoice', 'Date', 'Customer', 'Mobile', 'Total', 'Balance', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {data.items.slice((currentPage - 1) * size, currentPage * size).map(record => { const remaining = balance(record); return <Fragment key={record.number}><tr className={record.status === 'voided' ? 'voided-record' : ''}>
        <td>{record.number}{record.status === 'voided' ? <span className="voided-badge">VOIDED</span> : record.status === 'pending' ? <span className="pending-badge">PENDING</span> : null}</td><td>{record.date}</td><td>{record.customer || 'Walk-in customer'}</td><td>{record.mobile || '—'}</td><td>{money(netTotal(record))}</td><td><span className={remaining.className}>{remaining.text}</span></td><td><button className="btn btn-ghost btn-sm" aria-expanded={expanded === record.number} disabled={busy || loading || Boolean(error)} onClick={() => setExpanded(expanded === record.number ? undefined : record.number)}>{expanded === record.number ? 'Hide' : 'Details'}</button></td>
      </tr>{expanded === record.number && <tr><td colSpan={7}><RecordDetails key={record.number + data.versions[record.number]} record={record} busy={busy || loading || Boolean(error)} settle={input => { void run(record, 'settle', input); }} action={action => { void run(record, action); }} confirm={action => setConfirmation({ action, record, version: data.versions[record.number] })} /></td></tr>}</Fragment>; })}
    </tbody></table></div>
    <Pagination total={data.items.length} page={currentPage} pageSize={size} setPage={value => { setPage(value); setExpanded(undefined); }} setPageSize={value => { setSize(value); setPage(1); setExpanded(undefined); }} />
    {loaded && !loading && !data.items.length && <div className="empty-state">{data.total ? 'No records match your filters.' : 'No invoices recorded yet.'}</div>}
    </div>
    {confirmation && <Dialog title={confirmation.action === 'paid' ? 'Confirm payment' : 'Delete invoice?'} confirmLabel={confirmation.action === 'paid' ? 'Yes, mark fully paid' : 'Delete invoice'} danger={confirmation.action === 'delete'} busy={busy} onClose={() => setConfirmation(undefined)} onConfirm={() => { void run(confirmation.record, confirmation.action === 'paid' ? 'settle' : 'delete', { method: 'amount', fullyPaid: true }, confirmation.version); }}><p>{confirmation.action === 'paid' ? 'Record a cash payment of ' + money(confirmation.record.due || 0) + ' and mark ' + confirmation.record.number + ' fully paid?' : 'Permanently delete ' + confirmation.record.number + '? Sales, payments, and dues will be removed, sold stock restored where applicable, and linked old-metal entries removed. Already-voided invoices will not restore stock twice. This cannot be undone from the app.'}</p></Dialog>}
    {message && <Dialog title={message.title} onClose={() => setMessage(undefined)}><p>{message.text}</p></Dialog>}
  </>;
}
