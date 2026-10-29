import type { DashboardSnapshot, DateRange, Rates, StockInput, StockSnapshot } from './types';
import type { TransactionKind, TransactionInput, TransactionSnapshot } from './types';
import type { InvoiceRecord, RecordFilters, RecordsSnapshot, SettlementInput } from './types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const recordsApi = {
  void: (number: string, version: string, reason: string) => mutate<{ record: InvoiceRecord; version: string }>('POST', '/api/invoices/' + encodeURIComponent(number) + '/void', { version, reason }),
  edit: (number: string, input: unknown) => mutate<{ record: InvoiceRecord; version: string }>('PUT', '/api/invoices/' + encodeURIComponent(number), input),
  get: (number: string, version = '') => get<{ record: InvoiceRecord; version: string }>('/api/records/' + encodeURIComponent(number) + '?' + new URLSearchParams({ version })),
  list: (filters: RecordFilters, signal: AbortSignal, page = 1, pageSize = 10) => get<RecordsSnapshot>('/api/records?' + new URLSearchParams({ q: filters.query, status: filters.status, from: filters.from, to: filters.to, page: String(page), pageSize: String(pageSize) }), signal),
  export: async (filters: RecordFilters): Promise<RecordsSnapshot> => {
    const reportPage = (page: number) => get<RecordsSnapshot>('/api/records?' + new URLSearchParams({ q: filters.query, status: filters.status, from: filters.from, to: filters.to, page: String(page), pageSize: '100', report: '1' }), AbortSignal.timeout(20000));
    const first = await reportPage(1);
    if (!first.pagination) return first;
    if (first.pagination.total > 2000) throw new Error('PDF export is limited to 2,000 invoices. Narrow the filters or use CSV for a large report.');
    for (let page = 2; page <= Math.ceil(first.pagination.total / 100); page++) {
      const next = await reportPage(page);
      if (next.revision !== first.revision) throw new Error('Records changed during export. Please retry.');
      first.items.push(...next.items);
    }
    return first;
  },
  settle: (number: string, version: string, input: SettlementInput) => mutate<{ record: InvoiceRecord; settled: number }>('POST', '/api/records/' + encodeURIComponent(number) + '/settlements', { ...input, version }),
  remove: (number: string) => mutate<{ ok: boolean }>('DELETE', '/api/invoices/' + encodeURIComponent(number), {})
};

export interface DataLocation { path: string; desktop: boolean }
export interface BackupStatus { latest: string | null; desktop: boolean }
export interface DatabaseBackupStatus extends BackupStatus {
  backend: 'sqlite'; directory: string; backupRoot?: string;
  backups: { name: string; portable: boolean; createdAt: string }[];
}
export const databaseBackupApi = {
  status: (signal?: AbortSignal) => get<DatabaseBackupStatus>('/api/backup-status', signal),
  run: async (action: 'portable' | 'verify' | 'import' | 'prepare' | 'activate' | 'location', passphrase: string, name?: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch('/api/database-backup/' + action, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...extra, passphrase, name }), signal: AbortSignal.timeout(120000)
    });
    const result = await response.json() as { error?: string; path?: string; message?: string; name?: string; token?: string; counts?: { collection: string; count: number }[]; safety?: string; restored?: boolean };
    if (!response.ok) throw new ApiError(result.error || 'Backup operation failed.', response.status);
    return result;
  }
};
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
  list: (kind: TransactionKind, signal: AbortSignal, page = 1, pageSize = 10) => get<TransactionSnapshot>('/api/' + kind + '?' + new URLSearchParams({ page: String(page), pageSize: String(pageSize) }), signal),
  save: (kind: TransactionKind, input: TransactionInput, id?: string, version?: string) => mutate<TransactionSnapshot>(id ? 'PUT' : 'POST', '/api/' + kind + (id ? '/' + encodeURIComponent(id) : ''), { ...input, version }),
  remove: (kind: TransactionKind, id: string, version: string) => mutate<TransactionSnapshot>('DELETE', '/api/' + kind + '/' + encodeURIComponent(id), { version })
};

export const stockApi = {
  list: (signal: AbortSignal, page = 1, pageSize = 10, query = '') => get<StockSnapshot>('/api/stocks?' + new URLSearchParams({ page: String(page), pageSize: String(pageSize), query }), signal),
  create: (input: StockInput) => mutateStock('POST', '/api/stocks', input),
  edit: (id: string, input: StockInput, version: string) => mutateStock('PUT', '/api/stocks/' + encodeURIComponent(id), { ...input, version }),
  batch: (id: string, input: StockInput, version: string) => mutateStock('POST', '/api/stocks/' + encodeURIComponent(id) + '/batches', { ...input, version }),
  remove: (id: string, version: string) => mutateStock('DELETE', '/api/stocks/' + encodeURIComponent(id), { version })
};
