export const PIN_SESSION_KEY: string;
export function pinError(value: string): string;
export function isPinUnlocked(storage: Pick<Storage, 'getItem'>): boolean;
export function savePinSession(storage: Pick<Storage, 'setItem'>): boolean;
