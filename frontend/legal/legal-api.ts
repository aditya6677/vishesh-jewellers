export interface LegalDocument { id: string; title: string; summary: string; url: string }
export interface LegalStatus {
  version: string; acceptanceVersion: string; documentHash: string; enabled: boolean; accepted: boolean; canAccept: boolean;
  business: { name: string; address: string; email: string }; documents: LegalDocument[];
  acceptance: null | { policyVersion: string; acceptanceVersion: string; documentHash: string; acceptedAt: string; name: string; username: string; role: string; appVersion: string };
}
export async function legalStatus(signal?: AbortSignal): Promise<LegalStatus> {
  const response = await fetch('/api/legal', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Legal information is unavailable. Restart the updated app and try again.');
  return response.json() as Promise<LegalStatus>;
}
export async function acceptLegal(status: LegalStatus): Promise<LegalStatus> {
  const response = await fetch('/api/legal/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accepted: true, acceptanceVersion: status.acceptanceVersion, documentHash: status.documentHash }) });
  const result = await response.json() as LegalStatus & { error?: string };
  if (!response.ok) throw new Error(result.error || 'Could not record acceptance. Please try again.');
  window.dispatchEvent(new Event('vj:legal-refresh'));
  return result;
}
