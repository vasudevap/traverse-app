import type { AuthRole } from './auth-security.js';

export interface AuthConfig {
  allowedOrigins: ReadonlySet<string>;
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

const PRODUCTION_ORIGINS = [
  'https://admin.traversecoaching.com',
  'https://app.traversecoaching.com',
  'https://billing.traversecoaching.com',
  'https://client.traversecoaching.com',
] as const;

const NONPROD_ORIGINS = [
  'https://staging-admin.traversecoaching.com',
  'https://staging-app.traversecoaching.com',
  'https://staging-billing.traversecoaching.com',
  'https://staging-client.traversecoaching.com',
] as const;

export const SURFACE_ROLES = {
  admin: 'admin',
  billing: 'billingAdmin',
  client: 'client',
  coach: 'coach',
} as const satisfies Record<string, AuthRole>;

export type AuthSurface = keyof typeof SURFACE_ROLES;

export function isAuthSurface(value: string): value is AuthSurface {
  return Object.hasOwn(SURFACE_ROLES, value);
}

export function defaultAllowedOrigins(environment: string | undefined): ReadonlySet<string> {
  return new Set(environment === 'nonprod' ? NONPROD_ORIGINS : PRODUCTION_ORIGINS);
}

export function configuredAllowedOrigins(
  rawOrigins: string | undefined,
  environment: string | undefined,
): ReadonlySet<string> {
  if (rawOrigins === undefined || rawOrigins.trim() === '') {
    return defaultAllowedOrigins(environment);
  }

  const origins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
  if (origins.length === 0 || origins.some((origin) => new URL(origin).origin !== origin)) {
    throw new Error('AUTH_ALLOWED_ORIGINS must contain exact comma-separated origins.');
  }
  return new Set(origins);
}
