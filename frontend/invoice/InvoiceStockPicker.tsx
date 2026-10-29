import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StockItem } from '../types';

const weight = (value: number) => (Number(value) || 0).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export function InvoiceStockPicker({ stocks, available, selectedId, rowNumber, onSelect, disabled, required, portalTarget }: {
  stocks: StockItem[]; available: Record<string, number>; selectedId: string; rowNumber: number;
  onSelect: (id: string, stock?: StockItem) => void; disabled: boolean; required: boolean; portalTarget?: HTMLElement;
}) {
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [query, setQuery] = useState<string | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteItems, setRemoteItems] = useState<StockItem[] | null>(null);
  const [remoteError, setRemoteError] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const selected = stocks.find(stock => stock.id === selectedId);
  const label = selected ? `${selected.item} · ${selected.purity} · ${available[selected.id] || 0} pcs · #${String(selected.id).slice(-4)}` : '';
  const search = (query || '').trim().toLowerCase();
  const options = window.vjDatabaseMode ? remoteItems || stocks : stocks;
  const qty = (stock: StockItem) => available[stock.id] ?? stock.qty;
  const matches = options.filter(stock => ((qty(stock) || 0) > 0 || stock.id === selectedId)
    && (!search || `${stock.item} ${stock.purity} ${stock.id} ${available[stock.id]} ${stock.gross} ${stock.net}`.toLowerCase().includes(search)));

  const close = () => { setPosition(null); setQuery(null); setActiveIndex(0); };
  const locate = () => {
    if (!input.current || disabled) return;
    const rect = input.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
    const height = Math.min(matches.length * 65 + 12, 320);
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: window.innerHeight - rect.bottom < height + 12 && rect.top > height + 12 ? rect.top - height - 6 : rect.bottom + 6, width });
  };
  const choose = (id: string) => { onSelect(id, options.find(stock => stock.id === id)); close(); };
  useEffect(() => {
    if (!window.vjDatabaseMode || !position) return;
    const controller = new AbortController();
    setRemoteBusy(true); setRemoteError('');
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/stocks?' + new URLSearchParams({ query: search, page: '1', pageSize: '50' }), { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Stock search failed.');
        if (controller.signal.aborted) return;
        setRemoteItems(result.items);
        window.dispatchEvent(new CustomEvent('vj:stock-cache-merge', { detail: result.items }));
      } catch (error) { if (!controller.signal.aborted) { setRemoteItems([]); setRemoteError((error as Error).message); } }
      finally { if (!controller.signal.aborted) setRemoteBusy(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [Boolean(position), search]);

  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && event.target !== input.current) close();
    };
    const reposition = () => locate();
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [Boolean(position), matches.length, disabled]);
  useEffect(() => { if (disabled) close(); }, [disabled]);

  return <>
    <input ref={input} type="search" className="f-stock-search" value={query === null ? label : query}
      placeholder="Search or select stock…" aria-label={`Search or select stock item ${rowNumber}`} autoComplete="off"
      aria-haspopup="listbox" aria-expanded={Boolean(position)} aria-controls={position ? menuId : undefined}
      disabled={disabled} required={required} onFocus={event => { locate(); event.currentTarget.select(); }} onClick={locate}
      onChange={event => { setQuery(event.currentTarget.value); setActiveIndex(0); locate(); }}
      onBlur={event => { if (!menu.current?.contains(event.relatedTarget as Node)) close(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        else if (event.key === 'Tab') close();
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); locate(); setActiveIndex(index => Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
        } else if (event.key === 'Enter' && position && matches.length) {
          event.preventDefault(); choose(matches[Math.min(activeIndex, matches.length - 1)].id);
        }
      }} />
    <input type="hidden" className="f-stock" value={selectedId} />
    {position && createPortal(<div ref={menu} id={menuId} className="stock-picker-menu" role="listbox" aria-label={`Stock items for invoice row ${rowNumber}`}
      style={{ ...position, display: 'block' }} onPointerDown={event => event.preventDefault()}>
      {remoteBusy && <div className="stock-picker-empty" role="status">Searching stock…</div>}
      {remoteError && <div className="stock-picker-empty" role="alert">{remoteError}</div>}
      {matches.length ? matches.map((stock, index) => <button key={stock.id} type="button" className="stock-picker-option" role="option"
        data-stock-id={stock.id} aria-selected={stock.id === selectedId} style={index === activeIndex ? { background: 'rgba(255,255,255,.08)' } : undefined}
        onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(stock.id)}>
        <span className="stock-option-name">{stock.item}</span>
        <span className="stock-option-meta">{stock.purity} · {qty(stock) || 0} pcs · Gross {weight(stock.gross)} g · Net {weight(stock.net)} g</span>
      </button>) : <div className="stock-picker-empty">No matching stock items</div>}
      {window.vjDatabaseMode && remoteItems?.length === 50 && <div className="stock-picker-empty">Showing 50 matches. Type more to narrow the search.</div>}
    </div>, portalTarget || document.body)}
  </>;
}
