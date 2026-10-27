import type { InvoiceRecord, StockItem } from '../types';

export interface EditLine {
  lineId: string; stockId: string; name: string; purity: string; hsn: string;
  gross: string | number; net: string | number; pcs: string | number; rate: string | number; making: string | number;
}
export interface EditExchange { id: string; metal: 'gold' | 'silver'; weight: string | number; rate: string | number; required?: boolean }
export interface EditableRecord extends InvoiceRecord {
  invoiceDate?: string; savedAt?: string; initialPaid?: number; weightMode?: string;
  soldItems?: EditLine[]; orderItems?: EditLine[]; terms?: string; invoiceMarkup?: string;
  manualDiscount?: number; discount?: string; tax?: string; gstRate?: number; gstin?: string;
}
export interface EditDraft {
  customer: string; invoiceDate: string; mobile: string; address: string; terms: string;
  items: EditLine[]; exchanges: EditExchange[]; manualDiscount: string; paid: string; gstRate: string;
}
export interface EditTotals { subtotal: number; disc: number; cgst: number; sgst: number; gstPct: number; grand: number; roundOff: number }
declare global {
  interface Window {
    vjInvoiceEditOpen: (number: string, version?: string) => Promise<void>;
    vjInvoiceEditMath: { initialPaidFor: (record: EditableRecord) => number; totals: (items: EditLine[], deduction: number, componentRate: number) => EditTotals; words: (amount: number) => string };
  }
}

const amount = (value: unknown) => Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0;
export function editDraft(record: EditableRecord): EditDraft {
  const exchanges = (record.exchanges || (record.exchange ? [record.exchange] : [])).map((entry, index) => ({ id: 'exchange-' + index, metal: entry.metal === 'silver' ? 'silver' as const : 'gold' as const, weight: Number(entry.weight) || 0, rate: Number(entry.rate) || 0 }));
  const exchange = (record.exchanges || (record.exchange ? [record.exchange] : [])).reduce((sum, entry) => sum + (Number(entry.value) || (Number(entry.weight) || 0) * (Number(entry.rate) || 0)), 0);
  return {
    customer: record.customer || '', invoiceDate: record.invoiceDate || record.savedAt?.slice(0, 10) || '', mobile: record.mobile || '', address: record.address || '', terms: record.terms || '',
    items: (record.status === 'pending' ? record.orderItems || [] : record.soldItems || []).map((item, index) => ({ ...item, lineId: item.lineId || 'edit-' + index,
      hsn: item.hsn || '', gross: (Number(item.gross) || 0) * (record.weightMode === 'line-total' ? 1 : Number(item.pcs) || 1), net: (Number(item.net) || 0) * (record.weightMode === 'line-total' ? 1 : Number(item.pcs) || 1) })),
    exchanges, manualDiscount: Math.max(Number.isFinite(Number(record.manualDiscount)) ? Number(record.manualDiscount) : amount(record.discount) - exchange, 0).toFixed(2),
    paid: window.vjInvoiceEditMath.initialPaidFor(record).toFixed(2), gstRate: String(record.gstRate != null ? Number(record.gstRate) : amount(record.tax) > 0 ? 3 : 0)
  };
}

export function editSummary(record: EditableRecord, draft: EditDraft) {
  const exchange = draft.exchanges.reduce((sum, entry) => sum + (Number(entry.weight) || 0) * (Number(entry.rate) || 0), 0);
  const discount = Math.max(Number(draft.manualDiscount) || 0, 0);
  const totals = window.vjInvoiceEditMath.totals(draft.items, exchange + discount, Number(draft.gstRate) / 2);
  const paid = Math.max(Number(draft.paid) || 0, 0) + Math.max((Number(record.paid) || 0) - window.vjInvoiceEditMath.initialPaidFor(record), 0);
  return { ...totals, exchange, discount, paid, due: Math.max(totals.grand - paid, 0), advance: Math.max(paid - totals.grand, 0) };
}

export function editStocks(record: EditableRecord, stocks: StockItem[]): StockItem[] {
  const result = stocks.map(item => ({ ...item }));
  for (const item of record.soldItems || []) {
    let stock = result.find(stock => stock.id === item.stockId);
    if (!stock) { stock = { id: item.stockId, item: item.name, purity: item.purity as StockItem['purity'], qty: 0, gross: 0, net: 0, added: '', rate: 0 }; result.push(stock); }
    const pcs = Number(item.pcs) || 1, multiplier = record.weightMode === 'line-total' ? 1 : pcs;
    stock.qty = (Number(stock.qty) || 0) + pcs;
    stock.gross = (Number(stock.gross) || 0) + (Number(item.gross) || 0) * multiplier;
    stock.net = (Number(stock.net) || 0) + (Number(item.net) || 0) * multiplier;
  }
  return result;
}
