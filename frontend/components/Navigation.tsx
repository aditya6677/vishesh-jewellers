import { useLayoutEffect, useState } from 'react';
import { APP_MENUS, refreshMenu, type AppPage } from '../../lib/navigation.mjs';

declare global {
  interface Window {
    vjRefreshInvoiceStock: () => Promise<void>;
  }
}

export function Navigation() {
  const [page, setPage] = useState<AppPage>('dashboard');
  useLayoutEffect(() => {
    // Toggle visibility only: never unmount a form or discard its current draft.
    document.querySelectorAll<HTMLElement>('.page').forEach(element => element.classList.toggle('active', element.id === 'page-' + page));
  }, [page]);
  async function open(next: AppPage) {
    if (!APP_MENUS.some(menu => menu.page === next)) return;
    setPage(next);
    try {
      await refreshMenu(next, {
        dashboard: async () => { (await window.vjDashboardReady).refresh(); },
        invoice: () => window.vjRefreshInvoiceStock(),
        event: name => { window.dispatchEvent(new Event(name)); }
      });
    } catch (_) { window.showAppMessage?.(next === 'home' ? 'Could not refresh stock. Please try opening Invoice again.' : 'Could not refresh this menu. Please try again.', 'error'); }
  }
  return <>{APP_MENUS.map(menu => <button key={menu.page} type="button" id={menu.id} data-page={menu.page} className={'tab-btn' + (page === menu.page ? ' active' : '')} aria-current={page === menu.page ? 'page' : undefined} onClick={() => { void open(menu.page); }}>{menu.label}</button>)}</>;
}
