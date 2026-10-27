import { useEffect, useRef, useState } from 'react';
import { clearPinSession, isPinUnlocked, PIN_LOCK_EVENT, pinError, savePinSession } from '../../lib/pin-lock.mjs';

function unlocked() { try { return isPinUnlocked(window.sessionStorage); } catch (_) { return false; } }

export function PinLock() {
  const [open, setOpen] = useState(() => !unlocked());
  const [pin, setPin] = useState(''), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function lock() {
      let cleared = false;
      try { cleared = clearPinSession(window.sessionStorage); } catch (_) { /* Lock the visible workspace even if storage is unavailable. */ }
      setPin('');
      setError(cleared ? '' : 'Session storage is unavailable. Close this tab to finish logging out.');
      setOpen(true);
    }
    window.addEventListener(PIN_LOCK_EVENT, lock);
    return () => window.removeEventListener(PIN_LOCK_EVENT, lock);
  }, []);
  useEffect(() => {
    const host = document.getElementById('react-pin-lock');
    document.body.classList.toggle('pin-locked', open);
    if (host) host.style.display = open ? 'grid' : 'none';
    if (open) input.current?.focus();
  }, [open]);
  if (!open) return null;
  return <div className="pin-lock-card">
    <img className="pin-lock-logo" src="/assets/vishesh-jewellers-logo.png" alt="Vishesh Jewellers" />
    <div className="eyebrow">Private workspace</div><h1>Welcome back</h1><p>Enter your 4-digit PIN to open Vishesh Jewellers.</p>
    <form className="pin-lock-form" noValidate onSubmit={event => {
      event.preventDefault();
      const message = pinError(pin);
      if (message) { setError(message); if (pin.trim()) setPin(''); input.current?.focus(); return; }
      let saved = false;
      try { saved = savePinSession(window.sessionStorage); } catch (_) { /* Remain locked when browser storage is unavailable. */ }
      if (!saved) { setError('Could not save your session. Enable browser storage and try again.'); input.current?.focus(); return; }
      setPin(''); setError(''); setOpen(false);
    }}>
      <input ref={input} className="pin-lock-input" type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]*" maxLength={4} aria-label="Four digit PIN" aria-describedby="react-pin-error" value={pin} onChange={event => setPin(event.currentTarget.value)} autoFocus />
      <div className="pin-lock-error" id="react-pin-error" role="alert">{error}</div>
      <button className="btn btn-gold" type="submit">Unlock App</button>
    </form>
  </div>;
}
