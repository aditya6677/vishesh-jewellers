import { money } from '../components/Metric';
import type { DashboardSummary } from '../types';

export function BusinessCharts({ value: summary }: { value: DashboardSummary }) {
  const cash = [
    { label: 'Customer collections', value: summary.collected, tone: 'income' },
    { label: 'Party payments', value: summary.party, tone: 'outgoing' },
    { label: 'Old-metal purchases', value: summary.purchases, tone: 'purchase' },
    { label: 'Expenses', value: summary.expenses, tone: 'expense' }
  ];
  const maximum = Math.max(1, ...cash.map(item => Math.abs(item.value)));
  const gold = Math.max(0, summary.gold.sales), silver = Math.max(0, summary.silver.sales);
  const total = gold + silver;
  const goldShare = total > 0 ? gold / total : 0;
  const circumference = 2 * Math.PI * 50;

  return <div className="business-charts" aria-label="Business overview charts">
    <section className="business-chart-card" aria-labelledby="cash-chart-title">
      <div className="business-chart-heading"><div><h4 id="cash-chart-title">Cash flow</h4><p>Money received and paid · selected period</p></div><span className="business-chart-tag">Cash only</span></div>
      <div className="cash-chart-bars">{cash.map(item => <div className="cash-chart-row" key={item.label}>
        <div><span>{item.label}</span><strong className={item.value < 0 ? 'due-amount' : ''}>{money(item.value)}</strong></div>
        <div className="cash-chart-track" role="img" aria-label={`${item.label}: ${money(item.value)}`}><span className={'cash-chart-fill is-' + item.tone} style={{ width: Math.abs(item.value) / maximum * 100 + '%' }} /></div>
      </div>)}</div>
      <div className="cash-chart-result"><span>After payment<small>Collections − party payments − purchases − expenses</small></span><strong className={summary.afterPayment < 0 ? 'due-amount' : summary.afterPayment > 0 ? 'paid-amount' : ''}>{money(summary.afterPayment)}</strong></div>
      <p className="business-chart-footnote">Cash movement, not profit. Metal settlements are excluded from collections.</p>
    </section>
    <section className="business-chart-card" aria-labelledby="metal-chart-title">
      <div className="business-chart-heading"><div><h4 id="metal-chart-title">Sales by metal</h4><p>Gold and silver item amounts</p></div></div>
      {total > 0 ? <div className="sales-mix-chart">
        <svg viewBox="0 0 140 140" role="img" aria-label={`Sales mix: gold ${(goldShare * 100).toFixed(1)}%, silver ${((1 - goldShare) * 100).toFixed(1)}%`}>
          <circle className="sales-mix-base" cx="70" cy="70" r="50" fill="none" strokeWidth="13" />
          <circle className="sales-mix-silver" cx="70" cy="70" r="50" fill="none" strokeWidth="13" />
          {gold > 0 && <circle className="sales-mix-gold" cx="70" cy="70" r="50" fill="none" strokeWidth="13" strokeDasharray={`${goldShare * circumference} ${circumference}`} transform="rotate(-90 70 70)" />}
          <text x="70" y="67" textAnchor="middle" className="sales-mix-percent">{(goldShare * 100).toFixed(0)}%</text><text x="70" y="84" textAnchor="middle" className="sales-mix-caption">Gold share</text>
        </svg>
        <div className="sales-mix-legend">{[{ label: 'Gold', value: gold, share: goldShare }, { label: 'Silver', value: silver, share: 1 - goldShare }].map(item => <div key={item.label}><span><i className={'mix-dot is-' + item.label.toLowerCase()} />{item.label}<small>{(item.share * 100).toFixed(1)}%</small></span><strong>{money(item.value)}</strong></div>)}</div>
      </div> : <div className="business-chart-empty">No completed metal sales in this period.<small>Charts appear as invoices are completed.</small></div>}
      <p className="business-chart-footnote">Item amounts include making charges, before GST, exchange and invoice discount. Voided and pending invoices are excluded.</p>
    </section>
  </div>;
}
