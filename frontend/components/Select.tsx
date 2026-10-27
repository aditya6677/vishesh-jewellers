import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export function Select({ label, value, options, onChange, name, disabled = false, compact = false, portalTarget }: {
  label: string; value: string; options: readonly string[]; onChange: (value: string) => void;
  name?: string; disabled?: boolean; compact?: boolean; portalTarget?: HTMLElement;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);

  function close(focus = false) { setPosition(null); if (focus) trigger.current?.focus(); }
  function open() {
    if (disabled || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 140), window.innerWidth - 24);
    const height = Math.min(options.length * 40 + 14, window.innerHeight * 0.48);
    const top = window.innerHeight - rect.bottom < height && rect.top > height ? rect.top - height - 4 : rect.bottom + 4;
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top, width });
  }
  useEffect(() => {
    if (!position) return;
    const buttons = menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    buttons?.[Math.max(0, options.indexOf(value))]?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    const reposition = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close(); };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [position]);

  function navigate(event: KeyboardEvent) {
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }
  return <div className={'app-select-control' + (compact ? ' is-compact' : '')}>
    {name && <input type="hidden" name={name} value={value} />}
    <button ref={trigger} type="button" className="app-select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={Boolean(position)} aria-controls={position ? id : undefined} disabled={disabled}
      onClick={() => position ? close() : open()} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); } }}>
      <span className="app-select-value">{value}</span><span className="app-select-chevron" aria-hidden="true" />
    </button>
    {position && createPortal(<div ref={menu} className="app-select-menu" style={{ ...position, display: 'block' }} onKeyDown={navigate}>
      <div className="app-select-options" role="listbox" id={id} aria-label={label}>
        {options.map(option => <button type="button" role="option" aria-selected={option === value} className={'app-select-option' + (option === value ? ' is-selected' : '')} key={option}
          onClick={() => { onChange(option); close(true); }}>{option}</button>)}
      </div>
    </div>, portalTarget || document.body)}
  </div>;
}
