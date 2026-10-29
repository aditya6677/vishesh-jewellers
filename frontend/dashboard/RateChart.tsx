import { useId, useState } from 'react';
import { Select } from '../components/Select';
import { money } from '../components/Metric';
import type { Rates } from '../types';

export function RateChart({ rates }: { rates: Rates }) {
  const [metal, setMetal] = useState('Gold');
  const [active, setActive] = useState<number | null>(null);
  const gradient = useId().replace(/:/g, '');
  const key = metal === 'Gold' ? 'goldPerGram' : 'silverPerGram';
  const points = (rates.history || []).filter(point => Number.isFinite(point[key]) && point[key] > 0);
  const values = points.map(point => point[key]);
  const low = Math.min(...values), high = Math.max(...values);
  const first = values[0], last = values[values.length - 1];
  const change = first > 0 ? (last - first) / first * 100 : 0;
  const selected = Math.min(active ?? points.length - 1, points.length - 1);
  const current = points[selected];
  const padding = Math.max((high - low) * .2, high * .001);
  const bottom = low - padding, top = high + padding;
  const x = (index: number) => 76 + index / Math.max(points.length - 1, 1) * 690;
  const y = (value: number) => 180 - (value - bottom) / (top - bottom) * 150;
  const line = values.map((value, index) => `${index ? 'L' : 'M'}${x(index)},${y(value)}`).join(' ');
  return <div className={'benchmark-chart ' + (metal === 'Silver' ? 'is-silver' : '')}>
    <div className="benchmark-chart-head"><div><h4>Rate trend</h4><p>{metal === 'Gold' ? '24K gold' : 'Fine silver'} · 999 purity · ₹ per gram</p></div>
      <div className="benchmark-metal-select"><Select label="Chart metal" value={metal} options={['Gold', 'Silver']} compact onChange={value => { setMetal(value); setActive(null); }} /></div>
    </div>
    {points.length < 2 ? <p className="benchmark-chart-note">Not enough dated quotes to show a trend yet.</p> : <>
      <div className="benchmark-chart-summary"><div><strong>{money(current[key])}<small> /g</small></strong><span>{current.quoteDate} · {current.session}</span></div>
        <span className={change < 0 ? 'due-amount' : change > 0 ? 'paid-amount' : 'muted'}>{change > 0 ? '+' : ''}{change.toFixed(2)}% <small>over shown period</small></span>
      </div>
      <svg className="benchmark-chart-svg" viewBox="0 0 800 220" role="img" aria-label={`${metal} IBJA ${rates.session} rate history, ${points.length} published dates, from ${points[0].quoteDate} to ${points[points.length - 1].quoteDate}`}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".22" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        {[0, 1, 2].map(index => { const value = bottom + index / 2 * (top - bottom); return <g key={index}><line x1="76" x2="766" y1={y(value)} y2={y(value)} className="benchmark-grid" /><text x="64" y={y(value) + 4} textAnchor="end" className="benchmark-axis">{value.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</text></g>; })}
        <path d={`${line} L${x(points.length - 1)},180 L76,180 Z`} fill={`url(#${gradient})`} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <line x1={x(selected)} x2={x(selected)} y1="25" y2="180" className="benchmark-guide" />
        {points.map((point, index) => <g key={point.quoteDate}><circle cx={x(index)} cy={y(point[key])} r={index === selected ? 5 : 3} fill="currentColor" />
          <circle cx={x(index)} cy={y(point[key])} r="16" fill="transparent" tabIndex={0} role="button" aria-label={`${point.quoteDate} ${point.session}: ${money(point[key])} per gram`} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActive(index); } }}><title>{`${point.quoteDate}: ${money(point[key])}/g`}</title></circle>
        </g>)}
        <text x="76" y="210" className="benchmark-axis">{points[0].quoteDate}</text><text x="766" y="210" textAnchor="end" className="benchmark-axis">{points[points.length - 1].quoteDate}</text>
      </svg>
      <div className="benchmark-chart-footer"><span>Period low <b>{money(low)}</b></span><span>Period high <b>{money(high)}</b></span><span>{points.length} published dates · {rates.session}</span></div>
      <p className="benchmark-chart-note">Available IBJA {rates.session} quotes · excludes GST and making · select a point for details</p>
    </>}
  </div>;
}
