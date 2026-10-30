// Sesión de las vistas operativas en el navegador.
// - Personal local (admin/staff): login email+password, token en localStorage
//   (`sgt_token`, la misma clave que usan las vistas legacy de src/views).
// - Publicador (artist/partner/promoter/venue): llega desde el principal con
//   `#sso=<token>`; el token se canjea y la sesión vive en sessionStorage, así se
//   cierra con la pestaña y no se mezcla con la del personal de puerta.

const STAFF_KEY = 'sgt_token';
const PUBLISHER_KEY = 'sgt_pub_token';

export type SessionKind = 'staff' | 'publisher';

export interface Identity {
  kind: SessionKind;
  role: string;
  first_name: string | null;
  email: string | null;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function read(storage: () => Storage, key: string): string | null {
  try { return storage().getItem(key); } catch { return null; }
}
function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch { /* almacenamiento bloqueado: la sesión dura lo que dure la página */ }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

let memoryToken: string | null = null;

export function currentToken(): string | null {
  return memoryToken ?? read(session, PUBLISHER_KEY) ?? read(local, STAFF_KEY);
}

async function parseError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  } catch { /* cuerpo no JSON */ }
  return `Request failed (${res.status})`;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiRaw(path, init);
  return (await res.json()) as T;
}

export async function apiRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = currentToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) throw new ApiError(await parseError(res), res.status);
  return res;
}

// Si la URL trae #sso=..., lo canjea por una sesión de publicador y limpia la URL
// (el token es de un solo uso y no debe quedar en el historial).
export async function consumeSsoFragment(): Promise<boolean> {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const sso = params.get('sso');
  if (!sso) return false;
  history.replaceState(null, '', window.location.pathname + window.location.search);

  const res = await fetch('/api/auth/sso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: sso }),
  });
  if (!res.ok) throw new ApiError(await parseError(res), res.status);
  const data = (await res.json()) as { token: string };
  memoryToken = data.token;
  write(session, PUBLISHER_KEY, data.token);
  return true;
}

export async function staffLogin(email: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new ApiError(await parseError(res), res.status);
  const data = (await res.json()) as { token: string };
  write(session, PUBLISHER_KEY, null);
  memoryToken = data.token;
  write(local, STAFF_KEY, data.token);
}

export async function whoAmI(): Promise<Identity | null> {
  if (!currentToken()) return null;
  try {
    return await api<Identity>('/api/auth/me');
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      logout();
      return null;
    }
    throw err;
  }
}

export function logout(): void {
  // Cierra solo la sesión activa: si era de publicador, la del staff (si existe) queda.
  if (read(session, PUBLISHER_KEY)) {
    write(session, PUBLISHER_KEY, null);
  } else {
    write(local, STAFF_KEY, null);
  }
  memoryToken = null;
}
