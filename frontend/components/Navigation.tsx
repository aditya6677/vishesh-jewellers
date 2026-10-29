import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { APP_MENUS, refreshMenu, type AppPage } from '../../lib/navigation.mjs';
import { PIN_LOCK_EVENT } from '../../lib/pin-lock.mjs';
import { ThemeToggle } from './ThemeToggle';
import { readPreference, writePreference } from '../workspace/preferences';

const icons: Record<AppPage, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  home: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  payments: 'M4 5h16v14H4zM4 9h16M15 14h2',
  purchases: 'M3 5h2l2 11h11l3-8H6M9 20h.01M18 20h.01',
  stocks: 'm12 3 9 5-9 5-9-5 9-5zM3 8v9l9 5 9-5V8M12 13v9',
  records: 'M5 3h14v18H5zM9 7h6M9 12h6M9 17h4',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2'
};

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
  const [collapsed, setCollapsed] = useState(() => readPreference('sidebar', 'expanded') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width:760px)').matches);
  useLayoutEffect(() => {
    const media = window.matchMedia('(max-width:760px)');
    const resize = () => { setNarrow(media.matches); setMobileOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    media.addEventListener('change', resize); window.addEventListener('keydown', escape);
    return () => { media.removeEventListener('change', resize); window.removeEventListener('keydown', escape); };
  }, []);
  useLayoutEffect(() => {
    document.body.classList.add('desktop-workspace');
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    writePreference('sidebar', collapsed ? 'collapsed' : 'expanded');
    return () => { document.body.classList.remove('desktop-workspace', 'sidebar-collapsed'); };
  }, [collapsed]);
  useLayoutEffect(() => {
    // Toggle visibility only: never unmount a form or discard its current draft.
    document.querySelectorAll<HTMLElement>('.page').forEach(element => element.classList.toggle('active', element.id === 'page-' + page));
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [page]);
  async function open(next: AppPage) {
    if (!APP_MENUS.some(menu => menu.page === next)) return;
    setPage(next);
    setMobileOpen(false);
    try {
      await refreshMenu(next, {
        dashboard: async () => { (await window.vjDashboardReady).refresh(); },
        invoice: () => window.vjRefreshInvoiceStock(),
        event: name => { window.dispatchEvent(new Event(name)); }
      });
    } catch (_) { window.showAppMessage?.(next === 'home' ? 'Could not refresh stock. Please try opening Invoice again.' : 'Could not refresh this menu. Please try again.', 'error'); }
  }
  return <><div className={'workspace-sidebar' + (mobileOpen ? ' mobile-open' : '')} id="workspace-sidebar" inert={narrow && !mobileOpen} aria-hidden={narrow && !mobileOpen ? true : undefined}>
    <div className="sidebar-caption"><span>WORKSPACE</span><button type="button" className="sidebar-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '›' : '‹'}</button></div>
    {allowed.map(menu => <button key={menu.page} type="button" id={menu.id} data-page={menu.page} title={menu.label} className={'tab-btn' + (page === menu.page ? ' active' : '')} aria-label={menu.label} aria-current={page === menu.page ? 'page' : undefined} onClick={() => { void open(menu.page); }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[menu.page]} /></svg><span className="sidebar-label">{menu.label}</span></button>)}
    <button type="button" className="tab-btn sidebar-help" title="Keyboard shortcuts (F1)" aria-label="Keyboard shortcuts" onClick={() => window.dispatchEvent(new Event('vj:shortcut-help'))}><span aria-hidden="true">⌨</span><span className="sidebar-label">Shortcuts <kbd>F1</kbd></span></button>
  </div>{mobileOpen && <button type="button" className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    {accountActions && createPortal(<>
      <button type="button" className="theme-toggle mobile-menu-toggle" aria-label="Toggle navigation" aria-controls="workspace-sidebar" aria-expanded={mobileOpen} onClick={() => setMobileOpen(value => !value)}>☰</button>
      {window.vjAccountSession && <button type="button" className="theme-toggle workspace-account" aria-label="Account & Users" title="Account & Users" onClick={() => { location.href = '/accounts'; }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
      </button>}
      <ThemeToggle /><button type="button" className="workspace-logout" aria-label="Log out and lock workspace" title="Log out" onClick={() => window.dispatchEvent(new Event(PIN_LOCK_EVENT))}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 8l4 4-4 4M8 12h13" /></svg>
      <span>Log out</span>
    </button></>, accountActions)}
  </>;
}
