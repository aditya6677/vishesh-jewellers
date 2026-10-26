import type { DashboardSnapshot, DateRange, Rates, StockInput, StockSnapshot } from './types';
import type { TransactionKind, TransactionInput, TransactionSnapshot } from './types';
import type { InvoiceRecord, RecordFilters, RecordsSnapshot, SettlementInput } from './types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const recordsApi = {
  list: (filters: RecordFilters, signal: AbortSignal) => get<RecordsSnapshot>('/api/records?' + new URLSearchParams({ q: filters.query, status: filters.status, from: filters.from, to: filters.to }), signal),
  settle: (number: string, version: string, input: SettlementInput) => mutate<{ record: InvoiceRecord; settled: number }>('POST', '/api/records/' + encodeURIComponent(number) + '/settlements', { ...input, version }),
  remove: (number: string) => mutate<{ ok: boolean }>('DELETE', '/api/invoices/' + encodeURIComponent(number), {})
};

export interface DataLocation { path: string; desktop: boolean }
export interface BackupStatus { latest: string | null; desktop: boolean }
export const settingsApi = {
  location: (signal?: AbortSignal) => get<DataLocation>('/api/data-location', signal),
  backups: (signal?: AbortSignal) => get<BackupStatus>('/api/backup-status', signal),
  action: (path: '/api/data-location' | '/api/backup/create' | '/api/backup/restore', input: unknown = {}) => mutate<{ ok: boolean }>('POST', path, input),
  download: async (path: '/api/export.xlsx' | '/api/backup/download') => {
    const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(60000) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new ApiError(result.error || 'Could not prepare the download.', response.status);
    }
    return response.blob();
  }
};

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

async function mutate<T>(method: string, url: string, input: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error || 'Could not save changes.', response.status);
  return result as T;
}

const mutateStock = (method: string, url: string, input: unknown) => mutate<StockSnapshot>(method, url, input);

export const transactionApi = {
  list: (kind: TransactionKind, signal: AbortSignal) => get<TransactionSnapshot>('/api/' + kind, signal),
  save: (kind: TransactionKind, input: TransactionInput, id?: string, version?: string) => mutate<TransactionSnapshot>(id ? 'PUT' : 'POST', '/api/' + kind + (id ? '/' + encodeURIComponent(id) : ''), { ...input, version }),
  remove: (kind: TransactionKind, id: string, version: string) => mutate<TransactionSnapshot>('DELETE', '/api/' + kind + '/' + encodeURIComponent(id), { version })
};

export const stockApi = {
  list: (signal: AbortSignal) => get<StockSnapshot>('/api/stocks', signal),
  create: (input: StockInput) => mutateStock('POST', '/api/stocks', input),
  edit: (id: string, input: StockInput, version: string) => mutateStock('PUT', '/api/stocks/' + encodeURIComponent(id), { ...input, version }),
  batch: (id: string, input: StockInput, version: string) => mutateStock('POST', '/api/stocks/' + encodeURIComponent(id) + '/batches', { ...input, version }),
  remove: (id: string, version: string) => mutateStock('DELETE', '/api/stocks/' + encodeURIComponent(id), { version })
};
