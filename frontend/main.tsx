import 'vite/modulepreload-polyfill';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './dashboard/Dashboard';
import { Stocks } from './stocks/Stocks';
import { Transactions } from './transactions/Transactions';
import { Settings } from './settings/Settings';
import { Records } from './records/Records';
import { InvoicePaymentSummary } from './invoice/InvoicePaymentSummary';
import { InvoiceExchange } from './invoice/InvoiceExchange';
import { InvoiceDetails } from './invoice/InvoiceDetails';
import { InvoiceItems } from './invoice/InvoiceItems';
import { InvoicePreview } from './invoice/InvoicePreview';
import { SavedInvoiceViewer } from './invoice/SavedInvoiceViewer';
import { InvoiceEditor } from './invoice/InvoiceEditor';
import { InvoiceVoid } from './invoice/InvoiceVoid';
import { InvoiceSuccess } from './invoice/InvoiceSuccess';
import { AppMessages } from './components/AppMessages';
import { PinLock } from './components/PinLock';
import { Navigation } from './components/Navigation';
import { restoreTheme } from './theme';
import { Workspace } from './workspace/Workspace';
import { LegalGate } from './legal/LegalGate';

restoreTheme();

const target = document.getElementById('react-dashboard');
const canView = (permission: string) => !window.vjAccountSession || window.vjAccountSession.permissions.includes(permission);
const navigationTarget = document.getElementById('react-navigation');
if (navigationTarget) {
  const actions = document.createElement('div');
  actions.id = 'workspace-account-actions';
  actions.className = 'workspace-account-actions';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', 'Account actions');
  navigationTarget.before(actions);
  // A fixed sidebar must not inherit the header's backdrop-filter containing block.
  document.body.append(navigationTarget);
  createRoot(navigationTarget).render(<Navigation />);
  const workspace = document.createElement('div');
  document.body.append(workspace);
  createRoot(workspace).render(<><Workspace /><LegalGate /></>);
}
const pinTarget = document.getElementById('react-pin-lock');
if (pinTarget && !window.vjAccountSession) createRoot(pinTarget).render(<PinLock />);
if (window.vjAccountSession) {
  document.body.classList.remove('pin-locked');
  const permissions = window.vjAccountSession.permissions;
  const restricted = document.createElement('style');
  const knownPermissions = ['stocks.create','stocks.edit','stocks.delete','payments.create','payments.edit','payments.delete','purchases.create','purchases.edit','purchases.delete','invoices.create','invoices.edit','invoices.void','invoices.delete','records.settle','records.export','dashboard.export','settings.backup','settings.restore','settings.export','settings.branding'];
  restricted.textContent = knownPermissions.filter(permission => !permissions.includes(permission)).map(permission => `[data-permission="${permission}"]{display:none!important}`).join('\n') + (!permissions.includes('invoices.create') ? '#btnCompleteSale,#btnSavePendingOrder{display:none!important}' : '');
  document.head.append(restricted);
  const planBanner = document.createElement('aside');
  planBanner.setAttribute('aria-live', 'polite');
  planBanner.className = 'license-status-banner';
  planBanner.hidden = true; document.querySelector('main')?.prepend(planBanner);
  const refreshPlan = async () => { try { const response = await fetch('/api/license'); if (!response.ok) return; const plan = await response.json() as { state: string; daysRemaining?: number; message: string }; planBanner.hidden = plan.state === 'disabled' || plan.state === 'paid'; planBanner.textContent = plan.state === 'trial' ? `Full-feature trial · ${plan.daysRemaining} days remaining · Manage your plan in Settings` : plan.message; } catch { /* API guards remain authoritative when a status refresh fails. */ } };
  void refreshPlan(); setInterval(() => { void refreshPlan(); }, 60000); window.addEventListener('vj:license-refresh', () => { void refreshPlan(); });
  window.addEventListener('vj:lock-workspace', () => { void fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).finally(() => { location.href = '/login'; }); });
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => { const result = await originalFetch(...args); if (result.status === 401) location.href = '/login'; if (result.status === 428) window.dispatchEvent(new Event('vj:legal-review')); return result; };
  let lastActivity = Date.now();
  for (const event of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(event, () => { lastActivity = Date.now(); }, { passive: true });
  setInterval(() => { if (Date.now() - lastActivity >= 30 * 60_000) window.dispatchEvent(new Event('vj:lock-workspace')); }, 10000);
}
const messagesTarget = document.getElementById('react-app-messages');
if (messagesTarget) createRoot(messagesTarget).render(<AppMessages />);
const successTarget = document.getElementById('react-invoice-success');
if (successTarget) createRoot(successTarget).render(<InvoiceSuccess />);
const voidTarget = document.getElementById('react-invoice-void');
if (voidTarget) createRoot(voidTarget).render(<InvoiceVoid />);
const editorTarget = document.getElementById('react-invoice-editor');
if (editorTarget) createRoot(editorTarget).render(<InvoiceEditor />);
const savedInvoiceTarget = document.getElementById('react-saved-invoice-viewer');
if (savedInvoiceTarget) createRoot(savedInvoiceTarget).render(<SavedInvoiceViewer />);
if (target && canView('dashboard.view')) createRoot(target).render(<Dashboard />);
const stockTarget = document.getElementById('react-stocks');
if (stockTarget && canView('stocks.view')) createRoot(stockTarget).render(<Stocks />);
const settingsTarget = document.getElementById('react-settings');
if (settingsTarget && canView('settings.view')) createRoot(settingsTarget).render(<Settings />);
const recordsTarget = document.getElementById('react-records');
if (recordsTarget && canView('records.view')) createRoot(recordsTarget).render(<Records />);
const invoicePaymentTarget = document.getElementById('react-invoice-payment-summary');
if (invoicePaymentTarget && !invoicePaymentTarget.hidden) createRoot(invoicePaymentTarget).render(<InvoicePaymentSummary />);
const invoiceExchangeTarget = document.getElementById('react-invoice-exchange');
if (invoiceExchangeTarget && !invoiceExchangeTarget.hidden) createRoot(invoiceExchangeTarget).render(<InvoiceExchange />);
const invoiceDetailsTarget = document.getElementById('react-invoice-details');
if (invoiceDetailsTarget) createRoot(invoiceDetailsTarget).render(<InvoiceDetails />);
const invoiceItemsTarget = document.querySelector<HTMLTableSectionElement>('tbody[data-react-invoice-items="true"]');
if (invoiceItemsTarget) createRoot(invoiceItemsTarget).render(<InvoiceItems />);
const invoicePreviewTarget = document.getElementById('react-invoice-preview');
if (invoicePreviewTarget) createRoot(invoicePreviewTarget).render(<InvoicePreview />);
for (const kind of ['purchases', 'payments'] as const) {
  const target = document.getElementById('react-' + kind);
  if (target && canView(kind + '.view')) createRoot(target).render(<Transactions kind={kind} />);
}
