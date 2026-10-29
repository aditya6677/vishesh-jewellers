export interface InvoiceCanvas { width: number; height: number; toDataURL(type: string): string }
export interface InvoicePdf { internal: { pageSize: { getWidth(): number } }; addImage(image: string, type: string, x: number, y: number, width: number, height: number): void; save(name: string): void }
export type InvoicePdfConstructor = new (orientation: string, unit: string, format: string) => InvoicePdf;
export type InvoiceCanvasRenderer = (node: HTMLElement, options: { scale: number; backgroundColor: string; onclone?: (document: Document) => void }) => Promise<InvoiceCanvas>;
export function printInvoice(flush: () => void, print: () => void): void;
export function downloadInvoicePdf(node: HTMLElement | null, number: string, renderer: InvoiceCanvasRenderer | undefined, Pdf: InvoicePdfConstructor | undefined): Promise<void>;
