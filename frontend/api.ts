import type { DashboardSnapshot, DateRange, Rates } from './types';

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal: signal || AbortSignal.timeout(20000) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'Could not load data. Please try again.');
  }
  return response.json() as Promise<T>;
}

export const dashboardApi = {
  snapshot: (range: DateRange, signal: AbortSignal) => get<DashboardSnapshot>('/api/dashboard?' + new URLSearchParams({ ...range }), signal),
  rates: (refresh: boolean, signal: AbortSignal) => get<Rates>('/api/live-rates' + (refresh ? '?refresh=1' : ''), signal)
};
