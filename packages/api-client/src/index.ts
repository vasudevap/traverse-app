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

export type SetupProgressStatus = 'complete' | 'pending' | 'skipped';
export type SetupStep =
  | 'branding'
  | 'coach'
  | 'dashboard'
  | 'defaults'
  | 'payments'
  | 'policies'
  | 'practice'
  | 'preview';

export interface CoachSetupSnapshot {
  agreementTemplate: { id: string; name: string } | null;
  checklist: Array<{
    label: string;
    required: boolean;
    status: SetupProgressStatus;
    step: SetupStep;
  }>;
  coach: {
    bio: string;
    discipline: string;
    displayName: string;
    profilePhotoRef: string | null;
    profilePhotoUrl: string | null;
    specialties: string[];
  };
  nextStep: SetupStep;
  onboardingDefaults: {
    contractRequired: boolean;
    countersignatureRequired: boolean;
    intakeRequired: boolean;
    inviteExpiryDays: number;
    paymentRequired: false;
    reminderCadenceDays: number[];
  };
  plan: { code: string; name: string; trialEndsAt: string };
  policies: {
    cancellationNoticeHours: number;
    cancellationSummary: string;
    refundPolicy: 'flexible' | 'standard' | 'strict';
    starterTemplateSelected: boolean;
    welcomeMessage: string;
  };
  practice: {
    businessAddress: string;
    businessEmail: string;
    displayName: string;
    legalName: string;
    phone: string;
    timezone: string;
    websiteUrl: string;
  };
  progress: {
    branding: SetupProgressStatus;
    onboardingDefaults: SetupProgressStatus;
    payments: SetupProgressStatus;
    policies: SetupProgressStatus;
    preview: SetupProgressStatus;
  };
  setupState: string;
}

export class ApiResponseError extends Error {
  constructor(
    readonly status: number,
    message = `Traverse API request failed with status ${status}.`,
  ) {
    super(message);
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
    let message: string | undefined;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Keep the stable fallback when the response is not JSON.
    }
    throw new ApiResponseError(response.status, message);
  }
  return (await response.json()) as T;
}

export interface CoachSetupApiClient {
  current(): Promise<CoachSetupSnapshot>;
  markPreviewed(): Promise<CoachSetupSnapshot>;
  saveCoachProfile(input: {
    bio: string;
    discipline: string;
    displayName: string;
    specialties: string[];
  }): Promise<CoachSetupSnapshot>;
  saveOnboardingDefaults(
    input: CoachSetupSnapshot['onboardingDefaults'],
  ): Promise<CoachSetupSnapshot>;
  savePolicies(input: CoachSetupSnapshot['policies']): Promise<CoachSetupSnapshot>;
  savePracticeProfile(input: CoachSetupSnapshot['practice']): Promise<CoachSetupSnapshot>;
  skipOptional(item: 'branding' | 'payments'): Promise<CoachSetupSnapshot>;
  uploadProfilePhoto(file: File): Promise<CoachSetupSnapshot>;
  useDefaultOnboarding(): Promise<CoachSetupSnapshot>;
  useDefaultPolicies(): Promise<CoachSetupSnapshot>;
}

export function createCoachSetupApiClient(
  baseUrl = API_BASE_DEFAULT,
  request: typeof fetch = globalThis.fetch,
): CoachSetupApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const setupUrl = (path = '') => `${normalizedBaseUrl}/coach/setup${path}`;

  async function csrfToken(): Promise<string> {
    const response = await request(`${normalizedBaseUrl}/coach/auth/csrf`, {
      credentials: 'include',
    });
    return (await responseJson<{ csrfToken: string }>(response)).csrfToken;
  }

  async function mutate<T>(path: string, method: 'PATCH' | 'POST', body?: unknown): Promise<T> {
    const csrf = await csrfToken();
    const response = await request(setupUrl(path), {
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-csrf-token': csrf,
      },
      method,
    });
    return responseJson<T>(response);
  }

  return {
    async current() {
      const response = await request(setupUrl(), { credentials: 'include' });
      return responseJson<CoachSetupSnapshot>(response);
    },
    markPreviewed: () => mutate('/previewed', 'POST'),
    saveCoachProfile: (input) => mutate('/coach-profile', 'PATCH', input),
    saveOnboardingDefaults: (input) => mutate('/onboarding-defaults', 'PATCH', input),
    savePolicies: (input) => mutate('/policies', 'PATCH', input),
    savePracticeProfile: (input) => mutate('/practice-profile', 'PATCH', input),
    skipOptional: (item) => mutate(`/skip/${item}`, 'POST'),
    async uploadProfilePhoto(file) {
      const prepared = await mutate<{
        headers: Record<string, string>;
        objectKey: string;
        uploadUrl: string;
      }>('/profile-photo', 'POST', { contentType: file.type, size: file.size });
      const upload = await request(prepared.uploadUrl, {
        body: file,
        headers: prepared.headers,
        method: 'PUT',
      });
      if (!upload.ok) throw new ApiResponseError(upload.status, 'Profile photo upload failed.');
      return mutate('/profile-photo/complete', 'POST', { objectKey: prepared.objectKey });
    },
    useDefaultOnboarding: () => mutate('/onboarding-defaults/use-defaults', 'POST'),
    useDefaultPolicies: () => mutate('/policies/use-defaults', 'POST'),
  };
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
