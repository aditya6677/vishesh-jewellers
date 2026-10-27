import { useEffect, useRef, useState } from 'react';
import { appMessage, type AppMessage } from '../../lib/app-message.mjs';

declare global { interface Window { vjAppMessageQueue?: unknown[] } }

export function AppMessages() {
  const [message, setMessage] = useState<AppMessage | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const drain = () => {
      const queue = window.vjAppMessageQueue || [];
      let latest: AppMessage | null = null;
      for (const value of queue.splice(0)) { const next = appMessage(value); if (next) latest = next; }
      if (latest) setMessage(latest);
    };
    window.addEventListener('vj:app-message', drain);
    drain();
    return () => window.removeEventListener('vj:app-message', drain);
  }, []);
  useEffect(() => { if (message && !dialog.current?.open) dialog.current?.showModal(); }, [message]);
  const close = () => { dialog.current?.close(); setMessage(null); };
  return message && <dialog ref={dialog} className="modal react-dialog shared-message-dialog" data-type={message.type} aria-labelledby="react-message-title" aria-describedby="react-message-text" onCancel={event => { event.preventDefault(); close(); }}>
    <div className="shared-message-icon" aria-hidden="true">{message.icon}</div>
    <h3 id="react-message-title">{message.title}</h3><p id="react-message-text">{message.text}</p>
    <button type="button" className="btn btn-gold" onClick={close} autoFocus>OK, got it</button>
  </dialog>;
}
