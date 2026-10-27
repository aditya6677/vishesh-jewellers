export const PIN_SESSION_KEY: string;
export const PIN_LOCK_EVENT: string;
export function clearPinSession(storage: Pick<Storage, 'removeItem' | 'setItem'>): boolean;
export function pinError(value: string): string;
export function isPinUnlocked(storage: Pick<Storage, 'getItem'>): boolean;
export function savePinSession(storage: Pick<Storage, 'setItem'>): boolean;
