import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  clearCookie,
  csrfCookie,
  CSRF_COOKIE_NAMES,
  parseCookies,
  sessionCookie,
} from './auth-http.js';
import { SESSION_COOKIE_NAMES } from './auth-security.js';
import {
  type AuthenticatedRequest,
  ClientCsrfGuard,
  ClientSessionGuard,
  CoachCsrfGuard,
  CoachSessionGuard,
} from './auth.guards.js';
import { AuthService } from './auth.service.js';
import {
  type ClientOnboardingActor,
  ClientOnboardingService,
  type CoachOnboardingActor,
} from './client-onboarding.service.js';

interface OnboardingRequest extends AuthenticatedRequest {
  socket?: { remoteAddress?: string };
}

interface HeaderResponse {
  setHeader(name: string, value: string | string[]): void;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestMetadata(request: OnboardingRequest) {
  const forwarded = headerValue(request.headers['x-forwarded-for']);
  return {
    ip: forwarded?.split(',').at(-1)?.trim() ?? request.socket?.remoteAddress ?? null,
    userAgent: headerValue(request.headers['user-agent']) ?? null,
  };
}

function coachActor(request: AuthenticatedRequest): CoachOnboardingActor {
  const session = request.authSession;
  if (
    session === undefined ||
    session.role !== 'coach' ||
    session.status !== 'active' ||
    session.tenantId === null ||
    session.coachId === null ||
    (session.practiceRole !== 'owner' && session.practiceRole !== 'coach')
  ) {
    throw new UnauthorizedException('An active coach session is required.');
  }
  return {
    coachId: session.coachId,
    practiceRole: session.practiceRole,
    tenantId: session.tenantId,
    userId: session.userId,
  };
}

function clientActor(request: AuthenticatedRequest): ClientOnboardingActor {
  const session = request.authSession;
  if (
    session === undefined ||
    session.role !== 'client' ||
    session.status !== 'active' ||
    session.clientId === null
  ) {
    throw new UnauthorizedException('An active client session is required.');
  }
  return { clientId: session.clientId, userId: session.userId };
}

@Controller('coach')
@UseGuards(CoachSessionGuard)
export class CoachClientOnboardingController {
  constructor(
    @Inject(ClientOnboardingService)
    private readonly onboarding: ClientOnboardingService,
  ) {}

  @Get('clients/invite-options')
  options(@Req() request: AuthenticatedRequest) {
    return this.onboarding.getInviteOptions(coachActor(request));
  }

  @Post('clients/invite')
  @UseGuards(CoachCsrfGuard)
  invite(@Req() request: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    return this.onboarding.createInvite(coachActor(request), body);
  }

  @Post('invites/:inviteId/resend')
  @UseGuards(CoachCsrfGuard)
  resend(
    @Param('inviteId') inviteId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.onboarding.resendInvite(coachActor(request), inviteId, body);
  }

  @Post('invites/:inviteId/revoke')
  @UseGuards(CoachCsrfGuard)
  revoke(@Param('inviteId') inviteId: string, @Req() request: AuthenticatedRequest) {
    return this.onboarding.revokeInvite(coachActor(request), inviteId);
  }

  @Get('contracts/:contractId')
  contract(@Param('contractId') contractId: string, @Req() request: AuthenticatedRequest) {
    return this.onboarding.getCoachContract(coachActor(request), contractId);
  }

  @Post('contracts/:contractId/sign')
  @UseGuards(CoachCsrfGuard)
  countersign(
    @Param('contractId') contractId: string,
    @Req() request: OnboardingRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.onboarding.countersignContract(
      coachActor(request),
      contractId,
      body,
      requestMetadata(request),
    );
  }
}

@Controller('client/invitations')
export class ClientInvitationController {
  constructor(
    @Inject(ClientOnboardingService)
    private readonly onboarding: ClientOnboardingService,
    @Inject(AuthService)
    private readonly auth: AuthService,
  ) {}

  @Get(':token')
  async inspect(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.onboarding.inspectInvite(token);
  }

  @Post(':token/accept')
  @UseGuards(ClientCsrfGuard)
  async accept(
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
    @Req() request: OnboardingRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const accepted = await this.onboarding.acceptInvite(token, body);
    const previousToken = parseCookies(headerValue(request.headers.cookie)).get(
      SESSION_COOKIE_NAMES.client,
    );
    const session = await this.auth.startSession({
      ...requestMetadata(request),
      previousToken,
      role: 'client',
      userId: accepted.userId,
    });
    const maxAgeSeconds = Math.max(
      0,
      Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
    );
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', [
      sessionCookie(SESSION_COOKIE_NAMES.client, session.sessionToken, maxAgeSeconds),
      csrfCookie(CSRF_COOKIE_NAMES.client, session.csrfToken, maxAgeSeconds),
    ]);
    return {
      csrfToken: session.csrfToken,
      relationshipId: accepted.relationshipId,
      snapshot: accepted.snapshot,
    };
  }

  @Post(':token/decline')
  @UseGuards(ClientCsrfGuard)
  async decline(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', [
      clearCookie(SESSION_COOKIE_NAMES.client, true),
      clearCookie(CSRF_COOKIE_NAMES.client, false),
    ]);
    return this.onboarding.declineInvite(token);
  }
}

@Controller('client/onboarding')
@UseGuards(ClientSessionGuard)
export class ClientOnboardingController {
  constructor(
    @Inject(ClientOnboardingService)
    private readonly onboarding: ClientOnboardingService,
  ) {}

  @Get(':relationshipId')
  get(@Param('relationshipId') relationshipId: string, @Req() request: AuthenticatedRequest) {
    return this.onboarding.getOnboarding(clientActor(request), relationshipId);
  }

  @Post(':relationshipId/contracts/:contractId/sign')
  @UseGuards(ClientCsrfGuard)
  sign(
    @Param('relationshipId') relationshipId: string,
    @Param('contractId') contractId: string,
    @Req() request: OnboardingRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.onboarding.signContract(
      clientActor(request),
      relationshipId,
      contractId,
      body,
      requestMetadata(request),
    );
  }

  @Post(':relationshipId/intake')
  @UseGuards(ClientCsrfGuard)
  submitIntake(
    @Param('relationshipId') relationshipId: string,
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.onboarding.submitIntake(clientActor(request), relationshipId, body);
  }
}
