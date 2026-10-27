export interface ReportFilters { query: string; status: string; from: string; to: string }
export interface ReportPdf {
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
  setFillColor(...values: number[]): void; setTextColor(...values: number[]): void;
  setDrawColor(...values: number[]): void; setFont(name: string, style: string): void;
  setFontSize(size: number): void; setLineWidth(width: number): void;
  rect(x: number, y: number, width: number, height: number, style?: string): void;
  text(text: string | string[], x: number, y: number, options?: { maxWidth: number }): void;
  splitTextToSize(text: string, width: number): string[]; addPage(): void; save(name: string): void;
}
export type ReportPdfConstructor = new (options: { orientation: string; unit: string; format: string }) => ReportPdf;
export function recordsReport(records: readonly unknown[], filters: ReportFilters, now?: Date): { rows: string[][]; filename: string; description: string };
export function downloadRecordsReport(records: readonly unknown[], filters: ReportFilters, Pdf: ReportPdfConstructor | undefined, now?: Date): number;
