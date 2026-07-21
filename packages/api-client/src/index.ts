/** Typed API client for the four SPAs. Fleshed out alongside apps/api routes (P3-B). */
function defaultApiBase(): string {
  if (typeof window === 'undefined') return '/api';

  const hostname = window.location.hostname;
  if (
    hostname === 'staging-app.traversecoaching.com' ||
    hostname === 'staging-client.traversecoaching.com'
  ) {
    return 'https://staging-api.traversecoaching.com';
  }
  if (hostname.endsWith('.traversecoaching.com')) return 'https://api.traversecoaching.com';

  return '/api';
}

export const API_BASE_DEFAULT = defaultApiBase();

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

export interface OnboardingGateConfig {
  contractRequired: boolean;
  countersignatureRequired: boolean;
  intakeRequired: boolean;
  paymentRequired: false;
}

export interface InviteOptions {
  defaults: OnboardingGateConfig & {
    inviteExpiryDays: number;
    reminderCadenceDays: number[];
  };
  forms: Array<{ id: string; name: string; version: number }>;
  templates: Array<{ id: string; name: string; version: number }>;
}

export interface InvitePreview {
  clientName: string;
  coachName: string;
  expiresAt: string;
  gates: OnboardingGateConfig;
  inviteId: string;
  practiceName: string;
  welcomeMessage: string;
}

export interface OnboardingSnapshot {
  coach: { name: string; practiceName: string };
  contract: null | {
    body: string;
    clientSigned: boolean;
    coachSigned: boolean;
    id: string;
    name: string;
  };
  gates: OnboardingGateConfig;
  intake: null | {
    fields: Array<{
      id: string;
      label: string;
      required: boolean;
      type: 'long_text' | 'short_text';
    }>;
    id: string;
    name: string;
    submitted: boolean;
  };
  relationshipId: string;
  state: string;
}

export interface CoachContractSnapshot {
  body: string;
  clientName: string;
  clientSigned: boolean;
  coachSigned: boolean;
  id: string;
  name: string;
  relationshipId: string;
  state: string;
}

export interface LoopAppointment {
  appointmentTypeId: string | null;
  bookedByClient: boolean;
  calendarUrl: string;
  endsAt: string;
  id: string;
  meetingLink: string | null;
  notes: string | null;
  startsAt: string;
  status: 'booked' | 'canceled' | 'completed' | 'scheduled';
  target: { id: string; name: string; type: 'client' | 'group' };
  timezone: string;
  title: string;
}

export interface LoopTask {
  clientName: string;
  completedAt: string | null;
  description: string | null;
  dueAt: string | null;
  id: string;
  relationshipId: string;
  status: 'assigned' | 'canceled' | 'completed';
  title: string;
}

export interface LoopAppointmentType {
  active: boolean;
  currency: string | null;
  defaultDurationMinutes: number;
  id: string;
  name: string;
  notes: string | null;
  priceAmount: number | null;
  selfBookable: boolean;
}

export interface LoopAvailability {
  active: boolean;
  endsAt: string | null;
  id: string;
  localEndsAt: string | null;
  localStartsAt: string | null;
  startsAt: string | null;
  timezone: string;
  type: 'slot' | 'weekly';
  weekday: number | null;
}

export interface LoopGroup {
  archivedAt: string | null;
  description: string | null;
  id: string;
  members: Array<{ clientId: string; name: string }>;
  name: string;
}

export interface CoachLoopDashboard {
  appointmentTypes: LoopAppointmentType[];
  coachName: string;
  groups: LoopGroup[];
  relationships: Array<{
    client: { email: string; id: string; name: string };
    health:
      | 'active'
      | 'awaiting_first_touch'
      | 'inactive_risk'
      | 'newly_active'
      | 'scheduled'
      | 'task_pending';
    id: string;
    lastActivityAt: string;
    nextAppointment: LoopAppointment | null;
    openTaskCount: number;
  }>;
  timezone: string;
  upcomingAppointments: LoopAppointment[];
}

export interface CoachLoopWorkspace {
  appointments: LoopAppointment[];
  client: { email: string; id: string; name: string; phone: string | null };
  health: CoachLoopDashboard['relationships'][number]['health'];
  id: string;
  notes: string;
  tasks: LoopTask[];
}

export interface ClientLoopHome {
  appointments: LoopAppointment[];
  nextAction:
    | { appointmentId: string; kind: 'appointment'; startsAt: string; title: string }
    | { kind: 'task'; taskId: string; title: string }
    | { kind: 'waiting'; message: string };
  relationships: Array<{
    appointmentTypes: LoopAppointmentType[];
    availableSlots: LoopAvailability[];
    coach: { name: string; practiceName: string };
    id: string;
  }>;
  tasks: LoopTask[];
}

export interface CoachLoopApiClient {
  addGroupMember(groupId: string, clientId: string): Promise<LoopGroup>;
  createAppointment(input: {
    appointmentTypeId: string | null;
    endsAt: string;
    groupId: string | null;
    meetingLink: string;
    notes: string;
    relationshipId: string | null;
    startsAt: string;
    timezone: string;
    title: string;
  }): Promise<LoopAppointment>;
  createAppointmentType(input: {
    currency: string | null;
    defaultDurationMinutes: number;
    name: string;
    notes: string;
    priceAmount: number | null;
    selfBookable: boolean;
  }): Promise<LoopAppointmentType>;
  createAvailability(input: {
    endsAt: string;
    startsAt: string;
    timezone: string;
    type: 'slot';
  }): Promise<LoopAvailability>;
  createGroup(input: { description: string; name: string }): Promise<LoopGroup>;
  createTask(input: {
    description: string;
    dueAt: string | null;
    relationshipId: string;
    title: string;
  }): Promise<LoopTask>;
  current(): Promise<CoachLoopDashboard>;
  listAvailability(): Promise<LoopAvailability[]>;
  removeAvailability(availabilityId: string): Promise<void>;
  removeGroupMember(groupId: string, clientId: string): Promise<LoopGroup>;
  saveNotes(relationshipId: string, notes: string): Promise<CoachLoopWorkspace>;
  updateAppointment(
    appointmentId: string,
    input:
      | { action: 'cancel' | 'complete' }
      | {
          action: 'reschedule';
          endsAt: string;
          meetingLink: string;
          notes: string;
          startsAt: string;
          timezone: string;
        },
  ): Promise<LoopAppointment>;
  updateAppointmentType(
    appointmentTypeId: string,
    input: Partial<Omit<LoopAppointmentType, 'id'>>,
  ): Promise<LoopAppointmentType>;
  updateGroup(
    groupId: string,
    input: { archived: boolean; description: string; name: string },
  ): Promise<LoopGroup>;
  updateTask(taskId: string, action: 'cancel' | 'reopen'): Promise<LoopTask>;
  workspace(relationshipId: string): Promise<CoachLoopWorkspace>;
}

export interface ClientLoopApiClient {
  completeTask(taskId: string): Promise<LoopTask>;
  confirmBooking(
    holdId: string,
    input: { appointmentTypeId: string; relationshipId: string },
  ): Promise<LoopAppointment>;
  createHold(input: { availabilityId: string; relationshipId: string }): Promise<{
    endsAt: string;
    expiresAt: string;
    id: string;
    relationshipId: string;
    startsAt: string;
  }>;
  current(): Promise<ClientLoopHome>;
  releaseHold(holdId: string): Promise<void>;
}

export interface ClientImportIssue {
  code: string;
  field: 'email' | 'name' | 'notes' | 'row' | 'tags';
  message: string;
  rowNumber: number;
}

export interface ClientImportPreview {
  filename: string;
  issues: ClientImportIssue[];
  rejectedRows: number;
  rows: Array<{
    email: string;
    name: string;
    notes: string;
    rowNumber: number;
    tags: string[];
    valid: boolean;
  }>;
  sourceSha256: string;
  totalRows: number;
  validRows: number;
}

export interface ClientImportSummary {
  completedAt: string | null;
  createdAt: string;
  errorReport: ClientImportIssue[];
  filename: string | null;
  id: string;
  importedRows: number | null;
  rejectedRows: number | null;
  status: 'failed' | 'pending' | 'processing' | 'ready';
  totalRows: number | null;
}

export interface PracticeExportSummary {
  archiveSizeBytes: number | null;
  completedAt: string | null;
  createdAt: string;
  errorCode: string | null;
  expiresAt: string | null;
  id: string;
  manifest: Record<string, unknown>;
  status: 'expired' | 'failed' | 'pending' | 'processing' | 'ready';
}

export interface CoachDataPortabilityApiClient {
  commitClientImport(input: { csv: string; filename: string }): Promise<ClientImportSummary>;
  downloadExport(exportId: string): Promise<{ expiresAt: string; exportId: string; url: string }>;
  listExports(): Promise<PracticeExportSummary[]>;
  listImports(): Promise<ClientImportSummary[]>;
  previewClientImport(input: { csv: string; filename: string }): Promise<ClientImportPreview>;
  requestExport(): Promise<PracticeExportSummary>;
}

export interface CoachInviteApiClient {
  create(input: {
    clientName: string;
    contractTemplateId: string | null;
    email: string;
    gates: OnboardingGateConfig;
    intakeFormId: string | null;
    inviteExpiryDays: number;
    phone: string;
  }): Promise<{
    clientName: string;
    email: string;
    expiresAt: string;
    id: string;
    relationshipId: string;
    status: 'invited';
  }>;
  options(): Promise<InviteOptions>;
}

export interface CoachContractApiClient {
  get(contractId: string): Promise<CoachContractSnapshot>;
  sign(contractId: string, signerName: string): Promise<OnboardingSnapshot>;
}

export interface ClientOnboardingApiClient {
  accept(
    token: string,
    input: { mode: 'magic_link' | 'password'; password?: string },
  ): Promise<{ csrfToken: string; relationshipId: string; snapshot: OnboardingSnapshot }>;
  current(relationshipId: string): Promise<OnboardingSnapshot>;
  decline(token: string): Promise<void>;
  inspect(token: string): Promise<InvitePreview>;
  signContract(
    relationshipId: string,
    contractId: string,
    signerName: string,
  ): Promise<OnboardingSnapshot>;
  submitIntake(
    relationshipId: string,
    answers: Record<string, string>,
  ): Promise<OnboardingSnapshot>;
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
  requestPasswordReset(surface: AuthSurface, email: string): Promise<{ status: 'accepted' }>;
  resetPassword(
    surface: AuthSurface,
    token: string,
    password: string,
  ): Promise<{ status: 'reset' }>;
}

export interface CoachSignupApiClient {
  create(input: CoachSignupInput): Promise<CoachSignupResult>;
  resendVerificationEmail(email: string): Promise<{ status: 'pending_verification' }>;
  verifyEmail(token: string): Promise<CoachSignupVerificationResult>;
}

export interface CoachSignupInput {
  acceptableUseAccepted: boolean;
  billingInterval: 'annual' | 'monthly';
  discipline: string;
  disciplineBand: 'permitted' | 'restricted';
  email: string;
  legalAccepted: boolean;
  name: string;
  password: string;
  planCode: 'starter' | 'practice' | 'established';
  practiceName: string;
  restrictedCredentialAttestation?: boolean;
  restrictedNonClinicalAttestation?: boolean;
  timezone?: string;
}

export interface CoachSignupResult {
  email: string;
  status: 'pending_verification';
  tenantId: string;
}

export interface CoachSignupVerificationResult {
  status: 'active';
  stripeSubscriptionId: string;
  tenantId: string;
  trialEndsAt: string;
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

    async requestPasswordReset(surface, email) {
      const csrfResponse = await request(authUrl(surface, 'csrf'), { credentials: 'include' });
      const { csrfToken } = await responseJson<{ csrfToken: string }>(csrfResponse);
      const response = await request(authUrl(surface, 'password-reset/request'), {
        body: JSON.stringify({ email }),
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        method: 'POST',
      });
      return responseJson<{ status: 'accepted' }>(response);
    },

    async resetPassword(surface, token, password) {
      const csrfResponse = await request(authUrl(surface, 'csrf'), { credentials: 'include' });
      const { csrfToken } = await responseJson<{ csrfToken: string }>(csrfResponse);
      const response = await request(authUrl(surface, 'password-reset/confirm'), {
        body: JSON.stringify({ password, token }),
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        method: 'POST',
      });
      return responseJson<{ status: 'reset' }>(response);
    },
  };
}

export function createCoachSignupApiClient(
  baseUrl = API_BASE_DEFAULT,
  request: typeof fetch = globalThis.fetch,
): CoachSignupApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const signupUrl = `${normalizedBaseUrl}/coach/signup`;

  async function csrfToken(): Promise<string> {
    const response = await request(`${normalizedBaseUrl}/coach/auth/csrf`, {
      credentials: 'include',
    });
    return (await responseJson<{ csrfToken: string }>(response)).csrfToken;
  }

  return {
    async create(input) {
      const csrf = await csrfToken();
      const response = await request(signupUrl, {
        body: JSON.stringify({
          ...input,
          acceptedLegalDocuments: [
            { documentType: 'coach_terms', version: '0.1-in-review' },
            { documentType: 'acceptable_use_policy', version: '0.1-in-review' },
          ],
        }),
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        method: 'POST',
      });
      return responseJson<CoachSignupResult>(response);
    },
    async verifyEmail(token) {
      const response = await request(`${signupUrl}/verify`, {
        body: JSON.stringify({ token }),
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      return responseJson<CoachSignupVerificationResult>(response);
    },
    async resendVerificationEmail(email) {
      const csrf = await csrfToken();
      const response = await request(`${signupUrl}/resend-verification`, {
        body: JSON.stringify({ email }),
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        method: 'POST',
      });
      return responseJson<{ status: 'pending_verification' }>(response);
    },
  };
}

async function csrfFor(
  baseUrl: string,
  surface: 'client' | 'coach',
  request: typeof fetch,
): Promise<string> {
  const response = await request(`${baseUrl}/${surface}/auth/csrf`, {
    credentials: 'include',
  });
  return (await responseJson<{ csrfToken: string }>(response)).csrfToken;
}

export function createCoachInviteApiClient(
  baseUrl = API_BASE_DEFAULT,
  request: typeof fetch = globalThis.fetch,
): CoachInviteApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  return {
    async options() {
      const response = await request(`${normalizedBaseUrl}/coach/clients/invite-options`, {
        credentials: 'include',
      });
      return responseJson<InviteOptions>(response);
    },
    async create(input) {
      const csrf = await csrfFor(normalizedBaseUrl, 'coach', request);
      const response = await request(`${normalizedBaseUrl}/coach/clients/invite`, {
        body: JSON.stringify(input),
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        method: 'POST',
      });
      return responseJson(response);
    },
  };
}

export function createCoachContractApiClient(
  baseUrl = API_BASE_DEFAULT,
  request: typeof fetch = globalThis.fetch,
): CoachContractApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  return {
    async get(contractId) {
      const response = await request(
        `${normalizedBaseUrl}/coach/contracts/${encodeURIComponent(contractId)}`,
        { credentials: 'include' },
      );
      return responseJson<CoachContractSnapshot>(response);
    },
    async sign(contractId, signerName) {
      const csrf = await csrfFor(normalizedBaseUrl, 'coach', request);
      const response = await request(
        `${normalizedBaseUrl}/coach/contracts/${encodeURIComponent(contractId)}/sign`,
        {
          body: JSON.stringify({ agreed: true, signerName }),
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          method: 'POST',
        },
      );
      return responseJson<OnboardingSnapshot>(response);
    },
  };
}

export function createClientOnboardingApiClient(
  baseUrl = API_BASE_DEFAULT,
  request: typeof fetch = globalThis.fetch,
): ClientOnboardingApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  async function mutate<T>(path: string, body?: unknown): Promise<T> {
    const csrf = await csrfFor(normalizedBaseUrl, 'client', request);
    const response = await request(`${normalizedBaseUrl}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-csrf-token': csrf,
      },
      method: 'POST',
    });
    return responseJson<T>(response);
  }
  return {
    accept: (token, input) =>
      mutate(`/client/invitations/${encodeURIComponent(token)}/accept`, input),
    async current(relationshipId) {
      const response = await request(
        `${normalizedBaseUrl}/client/onboarding/${encodeURIComponent(relationshipId)}`,
        { credentials: 'include' },
      );
      return responseJson<OnboardingSnapshot>(response);
    },
    async decline(token) {
      await mutate(`/client/invitations/${encodeURIComponent(token)}/decline`);
    },
    async inspect(token) {
      const response = await request(
        `${normalizedBaseUrl}/client/invitations/${encodeURIComponent(token)}`,
        { credentials: 'include' },
      );
      return responseJson<InvitePreview>(response);
    },
    signContract: (relationshipId, contractId, signerName) =>
      mutate(
        `/client/onboarding/${encodeURIComponent(relationshipId)}/contracts/${encodeURIComponent(contractId)}/sign`,
        { agreed: true, signerName },
      ),
    submitIntake: (relationshipId, answers) =>
      mutate(`/client/onboarding/${encodeURIComponent(relationshipId)}/intake`, { answers }),
  };
}

export function createCoachLoopApiClient(
  baseUrl = API_BASE_DEFAULT,
  request: typeof fetch = globalThis.fetch,
): CoachLoopApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  async function read<T>(path: string): Promise<T> {
    const response = await request(`${normalizedBaseUrl}/coach${path}`, { credentials: 'include' });
    return responseJson<T>(response);
  }
  async function mutate<T>(
    path: string,
    method: 'DELETE' | 'PATCH' | 'POST',
    body?: unknown,
  ): Promise<T> {
    const csrf = await csrfFor(normalizedBaseUrl, 'coach', request);
    const response = await request(`${normalizedBaseUrl}/coach${path}`, {
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
    addGroupMember: (groupId, clientId) =>
      mutate(
        `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(clientId)}`,
        'POST',
      ),
    createAppointment: (input) => mutate('/appointments', 'POST', input),
    createAppointmentType: (input) => mutate('/appointment-types', 'POST', input),
    createAvailability: (input) => mutate('/availability', 'POST', input),
    createGroup: (input) => mutate('/groups', 'POST', input),
    createTask: (input) => mutate('/tasks', 'POST', input),
    current: () => read('/loop/dashboard'),
    listAvailability: () => read('/availability'),
    async removeAvailability(availabilityId) {
      await mutate(`/availability/${encodeURIComponent(availabilityId)}`, 'DELETE');
    },
    removeGroupMember: (groupId, clientId) =>
      mutate(
        `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(clientId)}`,
        'DELETE',
      ),
    saveNotes: (relationshipId, notes) =>
      mutate(`/relationships/${encodeURIComponent(relationshipId)}/notes`, 'PATCH', { notes }),
    updateAppointment: (appointmentId, input) =>
      mutate(`/appointments/${encodeURIComponent(appointmentId)}`, 'PATCH', input),
    updateAppointmentType: (appointmentTypeId, input) =>
      mutate(`/appointment-types/${encodeURIComponent(appointmentTypeId)}`, 'PATCH', input),
    updateGroup: (groupId, input) =>
      mutate(`/groups/${encodeURIComponent(groupId)}`, 'PATCH', input),
    updateTask: (taskId, action) =>
      mutate(`/tasks/${encodeURIComponent(taskId)}`, 'PATCH', { action }),
    workspace: (relationshipId) =>
      read(`/relationships/${encodeURIComponent(relationshipId)}/workspace`),
  };
}

export function createClientLoopApiClient(
  baseUrl = API_BASE_DEFAULT,
  request: typeof fetch = globalThis.fetch,
): ClientLoopApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  async function mutate<T>(path: string, method: 'DELETE' | 'POST', body?: unknown): Promise<T> {
    const csrf = await csrfFor(normalizedBaseUrl, 'client', request);
    const response = await request(`${normalizedBaseUrl}/client${path}`, {
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
    completeTask: (taskId) => mutate(`/tasks/${encodeURIComponent(taskId)}/complete`, 'POST'),
    confirmBooking: (holdId, input) =>
      mutate(`/booking/holds/${encodeURIComponent(holdId)}/confirm`, 'POST', input),
    createHold: (input) => mutate('/booking/holds', 'POST', input),
    async current() {
      const response = await request(`${normalizedBaseUrl}/client/home`, {
        credentials: 'include',
      });
      return responseJson<ClientLoopHome>(response);
    },
    async releaseHold(holdId) {
      await mutate(`/booking/holds/${encodeURIComponent(holdId)}`, 'DELETE');
    },
  };
}

export function createCoachDataPortabilityApiClient(
  baseUrl = API_BASE_DEFAULT,
  request: typeof fetch = globalThis.fetch,
): CoachDataPortabilityApiClient {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  async function read<T>(path: string): Promise<T> {
    const response = await request(`${normalizedBaseUrl}/coach${path}`, { credentials: 'include' });
    return responseJson<T>(response);
  }
  async function mutate<T>(path: string, body?: unknown): Promise<T> {
    const csrf = await csrfFor(normalizedBaseUrl, 'coach', request);
    const response = await request(`${normalizedBaseUrl}/coach${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        'x-csrf-token': csrf,
      },
      method: 'POST',
    });
    return responseJson<T>(response);
  }
  return {
    commitClientImport: (input) => mutate('/imports/clients', input),
    downloadExport: (exportId) => read(`/exports/${encodeURIComponent(exportId)}/download`),
    listExports: () => read('/exports'),
    listImports: () => read('/imports'),
    previewClientImport: (input) => mutate('/imports/clients/preview', input),
    requestExport: () => mutate('/exports'),
  };
}
