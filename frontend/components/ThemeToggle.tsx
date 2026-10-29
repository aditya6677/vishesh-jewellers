import { useEffect, useState } from 'react';
import { applyTheme, persistTheme, THEME_KEY, type Theme } from '../theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== THEME_KEY && event.key !== null) return;
      const next = event.newValue === 'light' ? 'light' : 'dark';
      applyTheme(next); setTheme(next);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const next = theme === 'dark' ? 'light' : 'dark';
  return <button type="button" className="theme-toggle" aria-label={`Switch to ${next} mode`} aria-pressed={theme === 'light'} title={`Switch to ${next} mode`} onClick={() => {
    applyTheme(next); persistTheme(next); setTheme(next);
  }}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {theme === 'dark' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />}
    </svg><span>{next === 'light' ? 'Light mode' : 'Dark mode'}</span>
  </button>;
}
