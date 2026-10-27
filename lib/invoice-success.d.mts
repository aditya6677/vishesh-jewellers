export interface InvoiceSuccessMessage { number: string; title: string; note: string; viewLabel: string }
export function invoiceSuccessMessage(record: unknown): InvoiceSuccessMessage | null;
