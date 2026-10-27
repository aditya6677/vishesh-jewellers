export const APP_MENUS = Object.freeze([
  { page: 'dashboard', label: 'Dashboard', id: 'dashboardTab', event: '' },
  { page: 'home', label: 'Invoice', id: 'invoiceTab', event: '' },
  { page: 'payments', label: 'Payment', id: 'paymentsTab', event: 'vj:payments-refresh' },
  { page: 'purchases', label: 'Purchase', id: 'purchasesTab', event: 'vj:purchases-refresh' },
  { page: 'stocks', label: 'Stocks', id: 'stocksTab', event: 'vj:stocks-refresh' },
  { page: 'records', label: 'Records', id: 'recordsTab', event: 'vj:records-refresh' },
  { page: 'settings', label: 'Settings', id: 'settingsTab', event: 'vj:settings-refresh' }
].map(Object.freeze));

export async function refreshMenu(page, api) {
  const menu = APP_MENUS.find(menu => menu.page === page);
  if (!menu) throw new Error('Unknown app menu.');
  if (page === 'dashboard') await api.dashboard();
  else if (page === 'home') await api.invoice();
  else api.event(menu.event);
}
