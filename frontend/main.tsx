import 'vite/modulepreload-polyfill';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './dashboard/Dashboard';
import { Stocks } from './stocks/Stocks';

const target = document.getElementById('react-dashboard');
if (target) createRoot(target).render(<Dashboard />);
const stockTarget = document.getElementById('react-stocks');
if (stockTarget) createRoot(stockTarget).render(<Stocks />);
