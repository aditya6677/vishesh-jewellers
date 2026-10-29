export type Theme = 'dark' | 'light';
export const THEME_KEY = 'vj-ui-theme';

export function readTheme(storage: Pick<Storage, 'getItem'>): Theme {
  try { return storage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function restoreTheme() {
  try { applyTheme(readTheme(window.localStorage)); }
  catch { applyTheme('dark'); }
}

export function persistTheme(theme: Theme) {
  try { window.localStorage.setItem(THEME_KEY, theme); return true; }
  catch { return false; }
}
