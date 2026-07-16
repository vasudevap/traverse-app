/** Typed API client for the four SPAs. Fleshed out alongside apps/api routes (P3-B). */
export const API_BASE_DEFAULT = '/api';

export type AuthRole = 'admin' | 'billingAdmin' | 'client' | 'coach';
export type AuthSurface = 'admin' | 'billing' | 'client' | 'coach';

export interface AuthUser {
  clientId: string | null;
  coachId: string | null;
  email: string;
  name: string;
  practiceRole: 'coach' | 'owner' | null;
  role: AuthRole;
  status: string;
  tenantId: string | null;
  userId: string;
}

export interface LoginResponse {
  csrfToken: string;
  expiresAt: string;
  user: AuthUser;
}

export interface SessionResponse {
  expiresAt: string;
  lastSeenAt: string;
  user: AuthUser;
}

export class ApiResponseError extends Error {
  constructor(readonly status: number) {
    super(`Traverse API request failed with status ${status}.`);
    this.name = 'ApiResponseError';
  }
}

export interface AuthApiClient {
  currentSession(surface: AuthSurface): Promise<SessionResponse>;
  login(surface: AuthSurface, email: string, password: string): Promise<LoginResponse>;
  logout(surface: AuthSurface, csrfToken: string): Promise<void>;
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new ApiResponseError(response.status);
  }
  return (await response.json()) as T;
}

export function createAuthApiClient(
  baseUrl = API_BASE_DEFAULT,
  request: typeof fetch = globalThis.fetch,
): AuthApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const authUrl = (surface: AuthSurface, action: string) =>
    `${normalizedBaseUrl}/${surface}/auth/${action}`;

  return {
    async currentSession(surface) {
      const response = await request(authUrl(surface, 'session'), {
        credentials: 'include',
      });
      return responseJson<SessionResponse>(response);
    },

    async login(surface, email, password) {
      const csrfResponse = await request(authUrl(surface, 'csrf'), {
        credentials: 'include',
      });
      const { csrfToken } = await responseJson<{ csrfToken: string }>(csrfResponse);
      const response = await request(authUrl(surface, 'login'), {
        body: JSON.stringify({ email, password }),
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        method: 'POST',
      });
      return responseJson<LoginResponse>(response);
    },

    async logout(surface, csrfToken) {
      const response = await request(authUrl(surface, 'logout'), {
        credentials: 'include',
        headers: { 'x-csrf-token': csrfToken },
        method: 'POST',
      });
      if (!response.ok) {
        throw new ApiResponseError(response.status);
      }
    },
  };
}
