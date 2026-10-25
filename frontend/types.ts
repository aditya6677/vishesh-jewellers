export type Metal = 'gold' | 'silver';
export type InvoiceStatus = 'completed' | 'pending' | 'voided';
export type PaymentType = 'amount' | 'metal' | 'self-expense';
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
