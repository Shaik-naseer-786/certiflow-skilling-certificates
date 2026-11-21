// Tiny fetch wrapper. Keeps the login token in localStorage and sends it on every call.
export type User = { id: string; name: string; role: 'CENTRE' | 'DISTRICT_OFFICER' | 'QUALITY' | 'STATE'; district: string | null };

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) {
    super(message);
  }
}

export const getToken = () => localStorage.getItem('token');
export const setToken = (t: string | null) => (t ? localStorage.setItem('token', t) : localStorage.removeItem('token'));

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers,
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body);
  return body as T;
}

// Fetches a PDF with the login token and opens it in a new tab.
export async function openPdf(path: string) {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? 'Could not open PDF', {});
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank');
}
