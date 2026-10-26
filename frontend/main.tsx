import 'vite/modulepreload-polyfill';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './dashboard/Dashboard';
import { Stocks } from './stocks/Stocks';
import { Transactions } from './transactions/Transactions';
import { Settings } from './settings/Settings';

const target = document.getElementById('react-dashboard');
if (target) createRoot(target).render(<Dashboard />);
const stockTarget = document.getElementById('react-stocks');
if (stockTarget) createRoot(stockTarget).render(<Stocks />);
const settingsTarget = document.getElementById('react-settings');
if (settingsTarget) createRoot(settingsTarget).render(<Settings />);
for (const kind of ['purchases', 'payments'] as const) {
  const target = document.getElementById('react-' + kind);
  if (target) createRoot(target).render(<Transactions kind={kind} />);
}
