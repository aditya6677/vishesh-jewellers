import { money } from '../components/Metric';
import type { Rates } from '../types';
import { RateChart } from './RateChart';

function Change({ value, previous }: { value: number | null; previous: Rates['previousQuote'] }) {
  if (!previous || value === null || !Number.isFinite(value)) return null;
  const direction = value > 0.0001 ? 'up' : value < -0.0001 ? 'down' : 'flat';
  return <small className={'rate-change rate-change-' + direction}>{value > 0 ? '+' : ''}{value.toFixed(2)}% vs {previous.quoteDate} {previous.session}</small>;
}

export function MarketRates({ rates, refresh, loading }: { rates: Rates | null; refresh: () => void; loading: boolean }) {
  if (!rates) return null;
  return <div className="panel market-rates-layout" id="liveRatesPanel">
    <section className="benchmark-quotes" aria-labelledby="benchmark-title">
      <p className="benchmark-eyebrow">Precious metals · India</p>
      <h3 id="benchmark-title">IBJA Benchmark Rates</h3>
      <div className="benchmark-quote-meta"><span>{rates.quoteDate} <span className="benchmark-session">{rates.session}</span></span>
      <button className="btn btn-ghost btn-sm live-rates-refresh" type="button" title="Refresh live rates" aria-label="Refresh live rates" onClick={refresh} disabled={loading}>↻</button>
      </div>
      <div className="benchmark-quote-list">
        <div className="benchmark-quote-card is-gold"><div className="benchmark-quote-label"><b><span className="benchmark-metal-dot" />Gold</b><span>999 / 24K</span></div><div className="benchmark-quote-price">{money(rates.goldPerGram)}<small> /g</small></div><Change value={rates.goldChangePercent} previous={rates.previousQuote} /></div>
        <div className="benchmark-quote-card is-silver"><div className="benchmark-quote-label"><b><span className="benchmark-metal-dot" />Silver</b><span>999 purity</span></div><div className="benchmark-quote-price">{money(rates.silverPerGram)}<small> /g</small></div><Change value={rates.silverChangePercent} previous={rates.previousQuote} /></div>
      </div>
      <p className="benchmark-quote-note">Published benchmark · ₹ per gram</p>
    </section>
    <RateChart rates={rates} />
  </div>;
}
