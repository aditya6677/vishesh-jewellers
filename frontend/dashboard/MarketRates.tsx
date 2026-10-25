import { money } from '../components/Metric';
import type { Rates } from '../types';

function Change({ value, previous }: { value: number | null; previous: Rates['previousQuote'] }) {
  if (!previous || value === null || !Number.isFinite(value)) return null;
  const direction = value > 0.0001 ? 'up' : value < -0.0001 ? 'down' : 'flat';
  return <small className={'rate-change rate-change-' + direction}>{value > 0 ? '+' : ''}{value.toFixed(2)}% vs {previous.quoteDate} {previous.session}</small>;
}

export function MarketRates({ rates, refresh, loading }: { rates: Rates | null; refresh: () => void; loading: boolean }) {
  if (!rates) return null;
  return <div className="panel" id="liveRatesPanel" style={{ marginBottom: 20 }}>
    <div className="toolbar"><h3 style={{ margin: 0 }}>IBJA Benchmark Rates</h3><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: 'var(--ivory-3)', fontSize: 11 }}>{rates.quoteDate} · {rates.session}</span>
      <button className="btn btn-ghost btn-sm live-rates-refresh" type="button" title="Refresh live rates" aria-label="Refresh live rates" onClick={refresh} disabled={loading}>↻</button>
    </div></div>
    <div className="record-info-grid" style={{ marginBottom: 0 }}>
      <div className="record-info"><b>Gold 999 / 24K (₹/g)</b><span className="paid-amount">{money(rates.goldPerGram)}</span><Change value={rates.goldChangePercent} previous={rates.previousQuote} /></div>
      <div className="record-info"><b>Silver 999 (₹/g)</b><span className="paid-amount">{money(rates.silverPerGram)}</span><Change value={rates.silverChangePercent} previous={rates.previousQuote} /></div>
    </div>
  </div>;
}
