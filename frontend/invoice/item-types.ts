import type { StockItem } from '../types';

export interface InvoiceItemRow {
  id: string; stockId: string; name: string; hsn: string; purity: string;
  gross: string | number; net: string | number; pcs: string | number;
  rate: string | number; making: string | number; amount: number;
  available: Record<string, number>;
}
export type InvoiceItemField = 'name' | 'purity' | 'gross' | 'net' | 'pcs' | 'rate' | 'making';
export interface InvoiceItemsSnapshot { items: InvoiceItemRow[]; stock: StockItem[]; pending: boolean }

declare global {
  interface Window {
    vjInvoiceItems?: {
      read: () => InvoiceItemsSnapshot;
      update: (id: string, field: InvoiceItemField, value: string) => void;
      commitQuantity: (id: string) => void;
      selectStock: (id: string, stockId: string) => Promise<void>;
      add: () => void;
      remove: (id: string) => void;
    };
  }
}
