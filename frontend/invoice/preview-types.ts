import type { InvoiceItemRow } from './item-types';
import type { InvoiceCanvasRenderer, InvoicePdfConstructor } from '../../lib/invoice-output.mjs';

export interface InvoicePreviewSnapshot {
  business: { name: string; gstin: string; phone: string; email: string; address: string };
  customer: { name: string; address: string; mobile: string };
  number: string; date: string; items: Omit<InvoiceItemRow, 'available'>[];
  totals: { subtotal: number; disc: number; cgst: number; sgst: number; gstPct: number; grand: number; roundOff: number };
  paid: number; terms: string; words: string; taxValue: string;
}

declare global {
  interface Window {
    vjInvoicePreviewSource?: { read: () => InvoicePreviewSnapshot; tax: (value: string) => void; terms: (value: string) => void };
    vjInvoicePreview?: { flush: () => void };
    html2canvas?: InvoiceCanvasRenderer;
    jspdf?: { jsPDF: InvoicePdfConstructor };
  }
}
