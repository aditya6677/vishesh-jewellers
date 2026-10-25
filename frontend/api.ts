import type { DashboardSnapshot, DateRange, Rates, StockInput, StockSnapshot } from './types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal: signal || AbortSignal.timeout(20000) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new ApiError(result.error || 'Could not load data. Please try again.', response.status);
  }
  return response.json() as Promise<T>;
}

export const dashboardApi = {
  snapshot: (range: DateRange, signal: AbortSignal) => get<DashboardSnapshot>('/api/dashboard?' + new URLSearchParams({ ...range }), signal),
  rates: (refresh: boolean, signal: AbortSignal) => get<Rates>('/api/live-rates' + (refresh ? '?refresh=1' : ''), signal)
};

async function mutateStock(method: string, url: string, input: unknown): Promise<StockSnapshot> {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error || 'Could not save stock.', response.status);
  return result as StockSnapshot;
}

export const stockApi = {
  list: (signal: AbortSignal) => get<StockSnapshot>('/api/stocks', signal),
  create: (input: StockInput) => mutateStock('POST', '/api/stocks', input),
  edit: (id: string, input: StockInput, version: string) => mutateStock('PUT', '/api/stocks/' + encodeURIComponent(id), { ...input, version }),
  batch: (id: string, input: StockInput, version: string) => mutateStock('POST', '/api/stocks/' + encodeURIComponent(id) + '/batches', { ...input, version }),
  remove: (id: string, version: string) => mutateStock('DELETE', '/api/stocks/' + encodeURIComponent(id), { version })
};
