import type { ServiceRequest } from './types';
export class ServiceError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const expiredListeners = new Set<(token: string) => void>();
export function onSessionExpired(listener: (token: string) => void) {
  expiredListeners.add(listener);
  return () => { expiredListeners.delete(listener); };
}
export async function api(path: string, options: Omit<ServiceRequest, 'path'> = {}) {
  let result: { status: number; data: any };
  try {
    if (window.stackscope) result = await window.stackscope.request({ path, ...options });
    else {
      const response = await fetch(path, { method: options.method ?? 'GET',
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}) },
        body: options.body ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(15000),
      });
      result = { status: response.status, data: await response.json().catch(() => ({ error: 'The account service is unavailable. Try again shortly.' })) };
    }
  } catch { throw new ServiceError('Cannot connect to the account service. Your local case is still available.', 0); }
  if (result.status === 401 && options.token) for (const listener of expiredListeners) listener(options.token);
  if (result.status >= 400 || result.data.error) throw new ServiceError(result.data.error ?? 'The service could not complete this request.', result.status);
  return result.data;
}
