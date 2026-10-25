import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Dialog({ title, children, onClose, onConfirm, busy = false, confirmLabel = 'Delete', danger = false }: {
  title: string; children: ReactNode; onClose: () => void; onConfirm?: () => void;
  busy?: boolean; confirmLabel?: string; danger?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return createPortal(<dialog ref={dialog} className="modal react-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h3 id={titleId}>{title}</h3><div>{children}</div>
    <div className="modal-actions">
      <button type="button" className={'btn btn-sm ' + (onConfirm ? 'btn-ghost' : 'btn-gold')} onClick={onClose} disabled={busy} autoFocus>{onConfirm ? 'Cancel' : 'OK, got it'}</button>
      {onConfirm && <button type="button" className={'btn btn-sm ' + (danger ? 'btn-danger' : 'btn-gold')} onClick={onConfirm} disabled={busy}>{busy ? 'Saving…' : confirmLabel}</button>}
    </div>
  </dialog>, document.body);
}
