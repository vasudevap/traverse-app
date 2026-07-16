import type { AuthRole } from './auth-security.js';

export const CSRF_COOKIE_NAMES: Record<AuthRole, string> = {
  admin: 'trv_csrf_admin',
  billingAdmin: 'trv_csrf_ba',
  client: 'trv_csrf_client',
  coach: 'trv_csrf_coach',
};

export function parseCookies(rawCookie: string | undefined): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  for (const item of rawCookie?.split(';') ?? []) {
    const separator = item.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name !== '' && value !== '') {
      cookies.set(name, decodeURIComponent(value));
    }
  }
  return cookies;
}

function baseCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; Secure; SameSite=Lax`;
}

export function sessionCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${baseCookie(name, value, maxAgeSeconds)}; HttpOnly`;
}

export function csrfCookie(name: string, value: string, maxAgeSeconds: number): string {
  return baseCookie(name, value, maxAgeSeconds);
}

export function clearCookie(name: string, httpOnly: boolean): string {
  return `${baseCookie(name, '', 0)}${httpOnly ? '; HttpOnly' : ''}`;
}
