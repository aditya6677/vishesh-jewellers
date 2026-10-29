import { useState } from 'react';

const prefix = 'vj-workspace-';
export function readPreference(key: string, fallback: string): string {
  try { return localStorage.getItem(prefix + key) ?? fallback; } catch { return fallback; }
}
export function writePreference(key: string, value: string): void {
  try { localStorage.setItem(prefix + key, value); } catch { /* Preferences must never block work. */ }
}
export function validPageSize(value: string): number {
  const size = Number(value);
  return [10, 25, 50, 100].includes(size) ? size : 10;
}
export function usePageSize(table: string): [number, (size: number) => void] {
  const [size, setSize] = useState(() => validPageSize(readPreference('page-size-' + table, '10')));
  return [size, value => { const next = validPageSize(String(value)); setSize(next); writePreference('page-size-' + table, String(next)); }];
}
