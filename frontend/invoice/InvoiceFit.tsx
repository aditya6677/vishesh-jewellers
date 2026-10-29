import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function previewScale(width: number, height: number, paperHeight: number): number {
  if (width <= 0 || height <= 0 || paperHeight <= 0) return 1;
  return Math.min(1, width / 850, height / paperHeight);
}

export function InvoiceFit({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => {
      if (!viewport.current || !stage.current) return;
      setScale(previewScale(Math.max(0, viewport.current.clientWidth - 24), Math.max(0, viewport.current.clientHeight - 24), stage.current.offsetHeight));
    };
    const observer = new ResizeObserver(fit);
    if (viewport.current) observer.observe(viewport.current);
    if (stage.current) observer.observe(stage.current);
    fit();
    return () => observer.disconnect();
  }, []);
  return <div ref={viewport} className="invoice-fit-viewport"><div ref={stage} className="invoice-fit-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>{children}</div></div>;
}

// Only the PDF renderer's cloned document changes; the on-screen preview stays fitted.
export function fullSizeInvoiceClone(document: Document): void {
  const stage = document.querySelector<HTMLElement>('.invoice-fit-stage');
  const viewport = document.querySelector<HTMLElement>('.invoice-fit-viewport');
  const drawer = document.querySelector<HTMLElement>('.invoice-preview-drawer');
  if (stage) Object.assign(stage.style, { transform: 'none', position: 'static', width: '850px' });
  if (viewport) Object.assign(viewport.style, { overflow: 'visible', width: '850px', height: 'auto' });
  if (drawer) Object.assign(drawer.style, { overflow: 'visible', width: '920px', height: 'auto', maxHeight: 'none', display: 'block' });
}
