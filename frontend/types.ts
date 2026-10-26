export type Metal = 'gold' | 'silver';
export type InvoiceStatus = 'completed' | 'pending' | 'voided';
export type PaymentType = 'amount' | 'metal' | 'self-expense';
export type Purity = '24K' | '22K' | '18K' | '14K' | 'Silver';
export interface StockInput { item: string; purity: Purity; qty: number; gross: number; net: number }
export interface StockItem extends StockInput { id: string; added: string; rate: number }
export interface StockSnapshot { items: StockItem[]; versions: Record<string, string> }
export type StockEditor = { mode: 'add' } | { mode: 'edit' | 'batch'; item: StockItem; version: string };
export interface DateRange { from: string; to: string }
export interface MetalSummary {
  sold: number; sales: number; received: number; receivedValue: number;
  balance: number; paid: number; finePaid: number;
}
export interface DashboardSummary {
  invoices: number; pending: number; sales: number; collected: number; due: number;
  party: number; expenses: number; purchases: number; beforeParty: number;
  afterPayment: number; openingCash: number; closingCash: number;
  gold: MetalSummary; silver: MetalSummary;
}
export interface DashboardSnapshot {
  summary: DashboardSummary;
  fresh: Record<Metal, number>;
  old: Record<Metal, number>;
  lowStockLimits: Record<Metal, number>;
}
export interface Rates {
  goldPerGram: number; silverPerGram: number; quoteDate: string; session: string;
  goldChangePercent: number | null; silverChangePercent: number | null;
  previousQuote?: { quoteDate: string; session: string };
}

declare global {
  interface Window {
    vjDashboardReady: Promise<{ refresh: (forceRates?: boolean) => void }>;
    resolveVjDashboard: (api: { refresh: (forceRates?: boolean) => void }) => void;
    showAppMessage?: (message: string, type: string) => void;
  }
}
export type TransactionKind = 'purchases' | 'payments';
export interface TransactionInput { type: PaymentType; metal: Metal; weight: number; rate: number; purity: number; amount: number; reason: string }
export interface TransactionEntry extends Partial<TransactionInput> { id: string; savedAt: string; fineWeight?: number }
export interface TransactionSnapshot { items: TransactionEntry[]; versions: Record<string, string>; balances: Record<Metal, number> }
export interface RecordFilters { query: string; status: string; from: string; to: string }
export interface InvoiceExchange { metal?: string; weight?: number; rate?: number; value?: number }
export interface InvoicePayment { method?: string; weight?: number | null; rate?: number | null; amount?: number; settledAt?: string }
export interface InvoiceRecord { number: string; date?: string; customer?: string; mobile?: string; address?: string; items?: string; status?: string; total?: number | string; returnTotal?: number; paid?: number; due?: number; exchanges?: InvoiceExchange[]; exchange?: InvoiceExchange; payments?: InvoicePayment[]; voidReason?: string }
export interface RecordsSnapshot { items: InvoiceRecord[]; total: number; versions: Record<string, string> }
export interface SettlementInput { method: string; amount?: number; weight?: number; rate?: number; fullyPaid?: boolean }
declare global {
  interface Window {
    vjRecordAction: (action: 'view' | 'edit' | 'void', number: string, version: string) => Promise<void>;
    vjRecordExport: (filters: RecordFilters) => Promise<void>;
  }
}
