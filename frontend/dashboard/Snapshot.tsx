import { Metric, type MetricUnit } from '../components/Metric';
import type { DashboardSummary } from '../types';

type Entry = [string, number, MetricUnit?, boolean?];

export function Snapshot({ value: s }: { value: DashboardSummary }) {
  const sections: [string, Entry[]][] = [
    ['Gold Sales', [['Total gold sold · net weight', s.gold.sold, 'weight'], ['Gold item amount', s.gold.sales]]],
    ['Silver Sales', [['Total silver sold · net weight', s.silver.sold, 'weight'], ['Silver item amount', s.silver.sales]]],
    ['Total Sales', [['Gold + silver item amount', s.gold.sales + s.silver.sales], ['Final invoice sales', s.sales], ['Completed invoices', s.invoices, 'count'], ['Pending orders', s.pending, 'count']]],
    ['Old Metal Received', [['Total old gold received', s.gold.received, 'weight'], ['Old gold value', s.gold.receivedValue], ['Total old silver received', s.silver.received, 'weight'], ['Old silver value', s.silver.receivedValue]]],
    ['Customer Collections', [['Amount paid by customers', s.collected], ['Outstanding due', s.due], ['Remaining before party payments', s.beforeParty]]],
    ['Outgoing Amounts', [['Payment to party', s.party], ['Old gold / silver purchases', s.purchases], ['Expenses · Self Expense', s.expenses]]],
    ['Metal Payments / Melting', [['Gold gross weight paid', s.gold.paid, 'weight'], ['Gold fine weight paid', s.gold.finePaid, 'weight'], ['Silver gross weight paid', s.silver.paid, 'weight'], ['Silver fine weight paid', s.silver.finePaid, 'weight']]],
    ['After Payment', [['Old gold · closing balance', s.gold.balance, 'weight', true], ['Old silver · closing balance', s.silver.balance, 'weight', true], ['Period amount after payment', s.afterPayment, 'money', true], ['Opening cash', s.openingCash], ['Closing cash', s.closingCash, 'money', true]]]
  ];
  return <div className="snapshot-sections" id="dashboardSnapshot">{sections.map(([title, entries]) =>
    <div className="snapshot-section" key={title}><h4>{title}</h4><div className="record-info-grid">
      {entries.map(([label, value, unit, emphasis]) => <Metric key={label} {...{ label, value, unit, emphasis }} />)}
    </div></div>
  )}</div>;
}
