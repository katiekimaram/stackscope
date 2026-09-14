import type { ServiceRequest } from './types';
export async function api(path: string, options: Omit<ServiceRequest, 'path'> = {}) {
  if (window.stackscope) {
    const result = await window.stackscope.request({ path, ...options });
    if (result.status >= 400) throw new Error(result.data.error ?? 'Service request failed.');
    return result.data;
  }
  const response = await fetch(path, { method: options.method ?? 'GET',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({ error: 'The community service is unavailable. Start npm run server or configure your host.' }));
  if (!response.ok || data.error) throw new Error(data.error ?? 'Service request failed.');
  return data;
}
