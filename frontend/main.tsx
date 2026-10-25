import 'vite/modulepreload-polyfill';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './dashboard/Dashboard';

const target = document.getElementById('react-dashboard');
if (target) createRoot(target).render(<Dashboard />);
