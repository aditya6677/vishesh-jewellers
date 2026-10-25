export type MetricUnit = 'money' | 'weight' | 'count';
export const money = (value: number) => '₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Metric({ label, value, unit = 'money', emphasis = false, className = '' }: {
  label: string; value: number; unit?: MetricUnit; emphasis?: boolean; className?: string;
}) {
  return <div className="record-info"><b>{label}</b>
    <span className={[className, emphasis ? 'dashboard-total' : '', value < 0 ? 'dashboard-negative' : ''].join(' ')}>
      {unit === 'weight' ? value.toFixed(3) + ' g' : unit === 'count' ? value : money(value)}
    </span>
  </div>;
}
