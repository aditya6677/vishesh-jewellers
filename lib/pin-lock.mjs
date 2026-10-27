export const PIN_SESSION_KEY = 'vishesh-jewellers-pin-unlocked';
export const PIN_LOCK_EVENT = 'vj:lock-workspace';
export function clearPinSession(storage) {
  try { storage.removeItem(PIN_SESSION_KEY); return true; }
  catch (_) {
    try { storage.setItem(PIN_SESSION_KEY, 'false'); return true; }
    catch (_) { return false; }
  }
}
export function pinError(value) {
  if (!value.trim()) return 'PIN is required.';
  return value === '5512' ? '' : 'Incorrect PIN. Please try again.';
}
export function isPinUnlocked(storage) {
  try { return storage.getItem(PIN_SESSION_KEY) === 'true'; }
  catch (_) { return false; }
}
export function savePinSession(storage) {
  try { storage.setItem(PIN_SESSION_KEY, 'true'); return true; }
  catch (_) { return false; }
}
