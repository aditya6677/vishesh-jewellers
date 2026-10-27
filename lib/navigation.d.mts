export type AppPage = 'dashboard' | 'home' | 'payments' | 'purchases' | 'stocks' | 'records' | 'settings';
export const APP_MENUS: readonly Readonly<{ page: AppPage; label: string; id: string; event: string }>[];
export function refreshMenu(page: AppPage, api: { dashboard: () => Promise<void>; invoice: () => Promise<void>; event: (event: string) => void }): Promise<void>;
