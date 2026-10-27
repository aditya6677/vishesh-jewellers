import { useEffect, useRef, useState, type FormEvent } from 'react';
import { dashboardApi } from '../api';
import { Metric } from '../components/Metric';
import { Snapshot } from './Snapshot';
import { MarketRates } from './MarketRates';
import type { DashboardSnapshot, DateRange, Metal, Rates } from '../types';

const emptyRange: DateRange = { from: '', to: '' };
const summaryNote = 'After Payment = customer money received − party payments − old-metal purchases − expenses. Includes pending-order advances; excludes metal settlements from cash. Item amounts include making, before GST and deductions. Old metal received includes purchases, exchange and settlements. Totals cover records stored in this app; previous-period and fine-metal opening balances have not been imported. Date filters use invoice dates for sales and transaction dates for collections and outgoings. Closing balances include earlier transactions. Due is the current due of invoices in the selected period. Fresh stock and market rates below are current. Historical reports reflect subsequent edits and deletions.';

export function Dashboard() {
  const rangeForm = useRef<HTMLFormElement>(null);
  const [range, setRange] = useState(emptyRange);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [rates, setRates] = useState<Rates | null>(null);
  const [error, setError] = useState('');
  const [loadingRates, setLoadingRates] = useState(false);
  const [revision, setRevision] = useState(0);
  const forceRates = useRef(false);
  const ratesController = useRef<AbortController | null>(null);

  async function loadRates(force: boolean) {
    ratesController.current?.abort();
    const controller = new AbortController();
    ratesController.current = controller;
    setLoadingRates(true);
    try { setRates(await dashboardApi.rates(force, controller.signal)); }
    catch (_) { if (!controller.signal.aborted) setRates(null); }
    finally { if (!controller.signal.aborted) setLoadingRates(false); }
  }

  useEffect(() => {
    window.resolveVjDashboard({ refresh: (force = false) => { forceRates.current = force; setRevision(value => value + 1); } });
    const offline = () => { ratesController.current?.abort(); setRates(null); setLoadingRates(false); };
    const online = () => { void loadRates(false); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); ratesController.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setSnapshot(null);
    dashboardApi.snapshot(range, controller.signal).then(setSnapshot).catch((cause: Error) => {
      if (!controller.signal.aborted) { setSnapshot(null); setError(cause.message); }
    });
    if (navigator.onLine) void loadRates(forceRates.current);
    forceRates.current = false;
    return () => controller.abort();
  }, [range, revision]);

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const draft = { from: String(form.get('from') || ''), to: String(form.get('to') || '') };
    if (draft.from && draft.to && draft.from > draft.to) {
      setError('From date must be on or before To date.');
      window.showAppMessage?.('From date must be on or before To date.', 'error');
      return;
    }
    setRange({ ...draft });
  }

  const low = snapshot ? (['gold', 'silver'] as Metal[]).filter(metal => snapshot.fresh[metal] <= snapshot.lowStockLimits[metal]) : [];
  return <>
    <div className="page-head"><p className="eyebrow">Business overview</p><h2>Dashboard</h2><p className="sub">A quick view of sales, collections, outstanding payments, and remaining metal stock.</p></div>
    <MarketRates rates={rates} refresh={() => { void loadRates(true); }} loading={loadingRates} />
    <div className="panel"><h3><span className="dot" />Business Snapshot</h3>
      <form className="snapshot-range" id="dashboardRangeForm" ref={rangeForm} onSubmit={applyRange}>
        <div className="range-date"><label htmlFor="dashboardFrom">From</label><input type="date" id="dashboardFrom" name="from" /></div>
        <div className="range-date"><label htmlFor="dashboardTo">To</label><input type="date" id="dashboardTo" name="to" /></div>
        <button className="btn btn-gold btn-sm" type="submit">Apply</button><button className="btn btn-ghost btn-sm" type="button" onClick={() => { rangeForm.current?.reset(); setRange({ ...emptyRange }); }}>All time</button>
        <span className="range-caption" id="dashboardRangeLabel" aria-live="polite">{range.from || range.to ? `${range.from || 'Beginning'} → ${range.to || 'Present'}` : ''}</span>
      </form>
      {error && <p role="alert" className="due-amount">{error} <button className="btn btn-ghost btn-sm" onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
      {snapshot ? <><Snapshot value={snapshot.summary} /><p className="dashboard-note">{summaryNote}</p></> : !error && <p role="status">Loading business snapshot…</p>}
    </div>
    {snapshot && <>
      <div className="dashboard-metal-grid">
        <div className="panel"><h3><span className="dot" />Fresh Stock Remaining</h3><div className="record-info-grid"><Metric label="Fresh Gold" value={snapshot.fresh.gold} unit="weight" /><Metric label="Fresh Silver" value={snapshot.fresh.silver} unit="weight" /></div></div>
        <div className="panel"><h3><span className="dot" />Old Metal Balance</h3><div className="record-info-grid"><Metric label="Old Gold" value={snapshot.old.gold} unit="weight" className="paid-amount" /><Metric label="Old Silver" value={snapshot.old.silver} unit="weight" className="paid-amount" /></div></div>
      </div>
      {low.length > 0 && <div className="panel low-stock-panel"><h3><span className="dot" />Low Stock Warning</h3><div className="low-stock-list">{low.map(metal => <div className="low-stock-item" key={metal}><b>{metal === 'gold' ? 'Gold' : 'Silver'} is running low</b><span>{snapshot.fresh[metal].toFixed(3)} g remaining · Alert below {snapshot.lowStockLimits[metal].toFixed(3)} g</span></div>)}</div></div>}
    </>}
  </>;
}
