import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { isAuthSurface, SURFACE_ROLES } from './auth-config.js';
import {
  authRoleForRequest,
  AuthenticatedSessionGuard,
  type AuthenticatedRequest,
  OriginCsrfGuard,
} from './auth.guards.js';
import {
  clearCookie,
  csrfCookie,
  CSRF_COOKIE_NAMES,
  parseCookies,
  sessionCookie,
} from './auth-http.js';
import { createOpaqueToken, SESSION_COOKIE_NAMES } from './auth-security.js';
import { AuthService } from './auth.service.js';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

interface LoginRequest extends AuthenticatedRequest {
  socket?: { remoteAddress?: string };
}

interface HeaderResponse {
  setHeader(name: string, value: string | string[]): void;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function forwardedIp(request: LoginRequest): string | null {
  const forwarded = headerValue(request.headers['x-forwarded-for']);
  return forwarded?.split(',').at(-1)?.trim() ?? request.socket?.remoteAddress ?? null;
}

function requireCredentials(body: LoginBody): { email: string; password: string } {
  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    throw new BadRequestException('Email and password are required.');
  }
  return { email: body.email, password: body.password };
}

@Controller(':surface/auth')
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
  ) {}

  @Get('csrf')
  csrf(@Param('surface') surface: string, @Res({ passthrough: true }) response: HeaderResponse) {
    if (!isAuthSurface(surface)) {
      throw new BadRequestException('Unknown application surface.');
    }
    const role = SURFACE_ROLES[surface];
    const csrfToken = createOpaqueToken();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', csrfCookie(CSRF_COOKIE_NAMES[role], csrfToken, 600));
    return { csrfToken };
  }

  @Post('login')
  @UseGuards(OriginCsrfGuard)
  async login(
    @Param('surface') surface: string,
    @Body() body: LoginBody,
    @Req() request: LoginRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    if (!isAuthSurface(surface)) {
      throw new BadRequestException('Unknown application surface.');
    }
    const role = SURFACE_ROLES[surface];
    const credentials = requireCredentials(body);
    const previousToken = parseCookies(headerValue(request.headers.cookie)).get(
      SESSION_COOKIE_NAMES[role],
    );
    const result = await this.authService.login({
      ...credentials,
      ip: forwardedIp(request),
      previousToken,
      role,
      userAgent: headerValue(request.headers['user-agent']) ?? null,
    });
    const maxAgeSeconds = Math.max(0, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', [
      sessionCookie(SESSION_COOKIE_NAMES[role], result.sessionToken, maxAgeSeconds),
      csrfCookie(CSRF_COOKIE_NAMES[role], result.csrfToken, maxAgeSeconds),
    ]);

    return {
      csrfToken: result.csrfToken,
      expiresAt: result.expiresAt.toISOString(),
      user: result.subject,
    };
  }

  @Get('session')
  @UseGuards(AuthenticatedSessionGuard)
  session(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const session = request.authSession;
    if (session === undefined) {
      throw new Error('Authenticated session guard did not attach a session.');
    }
    response.setHeader('Cache-Control', 'no-store');
    return {
      expiresAt: session.expiresAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      user: {
        clientId: session.clientId,
        coachId: session.coachId,
        email: session.email,
        name: session.name,
        practiceRole: session.practiceRole,
        role: session.role,
        status: session.status,
        tenantId: session.tenantId,
        userId: session.userId,
      },
    };
  }

  @Post('logout')
  @UseGuards(AuthenticatedSessionGuard, OriginCsrfGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const role = authRoleForRequest(request);
    if (request.sessionToken === undefined) {
      throw new Error('Authenticated session guard did not attach a token.');
    }
    await this.authService.logout(request.sessionToken, role);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Set-Cookie', [
      clearCookie(SESSION_COOKIE_NAMES[role], true),
      clearCookie(CSRF_COOKIE_NAMES[role], false),
    ]);
    return { status: 'signed_out' };
  }
}
