import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LegalDocument } from './legal-api';

export function PolicyReader({ document: policy, close }: { document: LegalDocument; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  return createPortal(<dialog ref={dialog} className="modal legal-reader" aria-label={policy.title} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="legal-reader-toolbar"><div><span className="legal-eyebrow">BUNDLED WITH THIS APP · AVAILABLE OFFLINE</span><h3>{policy.title}</h3></div><button type="button" className="btn btn-ghost btn-sm" onClick={close} autoFocus>Close</button></div>
    <iframe title={policy.title + ' document'} src={policy.url + '?theme=' + theme} sandbox="allow-same-origin" />
  </dialog>, document.body);
}
