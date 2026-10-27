export interface AppMessage { text: string; type: 'error' | 'success' | 'info'; title: string; icon: string }
export function appMessage(value: unknown): AppMessage | null;
