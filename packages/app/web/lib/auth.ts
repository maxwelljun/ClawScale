import type { AuthResult, PublicUser, Tenant } from '@clawscale/shared';

const TOKEN_KEY = 'cs_token';
const USER_KEY = 'cs_user';
const TENANT_KEY = 'cs_tenant';

export function storeAuth(result: AuthResult): void {
  localStorage.setItem(TOKEN_KEY, result.tokens.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(result.user));
  localStorage.setItem(TENANT_KEY, JSON.stringify(result.tenant));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TENANT_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): PublicUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as PublicUser; } catch { return null; }
}

export function getTenant(): Tenant | null {
  const raw = localStorage.getItem(TENANT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Tenant; } catch { return null; }
}

export function isAuthenticated(): boolean {
  return getToken() != null;
}
