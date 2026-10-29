import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { APP_MENUS, refreshMenu, type AppPage } from '../../lib/navigation.mjs';
import { PIN_LOCK_EVENT } from '../../lib/pin-lock.mjs';
import { ThemeToggle } from './ThemeToggle';

declare global {
  interface Window {
    vjRefreshInvoiceStock: () => Promise<void>;
    vjAccountSession?: { user: { name: string; role: string }; permissions: string[] };
  }
}

export function Navigation() {
  const accountActions = document.getElementById('workspace-account-actions');
  const allowed = APP_MENUS.filter(menu => !window.vjAccountSession || window.vjAccountSession.permissions.includes((menu.page === 'home' ? 'invoices' : menu.page) + '.view'));
  const [page, setPage] = useState<AppPage>(allowed[0]?.page || 'home');
  useLayoutEffect(() => {
    // Toggle visibility only: never unmount a form or discard its current draft.
    document.querySelectorAll<HTMLElement>('.page').forEach(element => element.classList.toggle('active', element.id === 'page-' + page));
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
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
  return <>{allowed.map(menu => <button key={menu.page} type="button" id={menu.id} data-page={menu.page} className={'tab-btn' + (page === menu.page ? ' active' : '')} aria-current={page === menu.page ? 'page' : undefined} onClick={() => { void open(menu.page); }}>{menu.label}</button>)}
    {accountActions && createPortal(<>
      {window.vjAccountSession && <button type="button" className="theme-toggle workspace-account" aria-label="Account & Users" title="Account & Users" onClick={() => { location.href = '/accounts'; }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
      </button>}
      <ThemeToggle /><button type="button" className="workspace-logout" aria-label="Log out and lock workspace" title="Log out" onClick={() => window.dispatchEvent(new Event(PIN_LOCK_EVENT))}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 8l4 4-4 4M8 12h13" /></svg>
      <span>Log out</span>
    </button></>, accountActions)}
  </>;
}
