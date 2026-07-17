import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedSession } from '@traverse/db';
import type { AuthRole } from './auth-security.js';
import { AUTH_CONFIG, type AuthConfig, isAuthSurface, SURFACE_ROLES } from './auth-config.js';
import {
  csrfTokenMatches,
  isTrustedStateChangingOrigin,
  SESSION_COOKIE_NAMES,
} from './auth-security.js';
import { AuthService } from './auth.service.js';
import { CSRF_COOKIE_NAMES, parseCookies } from './auth-http.js';

export interface AuthenticatedRequest {
  authSession?: AuthenticatedSession;
  headers: Record<string, string | string[] | undefined>;
  params: { surface?: string };
  sessionToken?: string;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestRole(request: AuthenticatedRequest) {
  const surface = request.params.surface;
  if (surface === undefined || !isAuthSurface(surface)) {
    throw new NotFoundException();
  }
  return SURFACE_ROLES[surface];
}

function assertOriginCsrf(
  request: AuthenticatedRequest,
  config: AuthConfig,
  role: AuthRole,
): boolean {
  const origin = headerValue(request.headers.origin);
  const cookies = parseCookies(headerValue(request.headers.cookie));
  const submittedToken = headerValue(request.headers['x-csrf-token']);
  const cookieToken = cookies.get(CSRF_COOKIE_NAMES[role]);

  if (
    !isTrustedStateChangingOrigin(origin, config.allowedOrigins) ||
    !csrfTokenMatches(submittedToken, cookieToken)
  ) {
    throw new ForbiddenException('Request verification failed.');
  }
  return true;
}

@Injectable()
export class AuthenticatedSessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = requestRole(request);
    const token = parseCookies(headerValue(request.headers.cookie)).get(SESSION_COOKIE_NAMES[role]);
    if (token === undefined) {
      throw new UnauthorizedException('Authentication required.');
    }

    request.authSession = await this.authService.authenticate(token, role);
    request.sessionToken = token;
    return true;
  }
}

async function authenticateForRole(
  request: AuthenticatedRequest,
  authService: AuthService,
  role: AuthRole,
): Promise<boolean> {
  const token = parseCookies(headerValue(request.headers.cookie)).get(SESSION_COOKIE_NAMES[role]);
  if (token === undefined) {
    throw new UnauthorizedException('Authentication required.');
  }
  request.authSession = await authService.authenticate(token, role);
  request.sessionToken = token;
  return true;
}

@Injectable()
export class CoachSessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    return authenticateForRole(
      context.switchToHttp().getRequest<AuthenticatedRequest>(),
      this.authService,
      'coach',
    );
  }
}

@Injectable()
export class ClientSessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    return authenticateForRole(
      context.switchToHttp().getRequest<AuthenticatedRequest>(),
      this.authService,
      'client',
    );
  }
}

@Injectable()
export class OriginCsrfGuard implements CanActivate {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return assertOriginCsrf(request, this.config, requestRole(request));
  }
}

@Injectable()
export class CoachCsrfGuard implements CanActivate {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  canActivate(context: ExecutionContext): boolean {
    return assertOriginCsrf(
      context.switchToHttp().getRequest<AuthenticatedRequest>(),
      this.config,
      'coach',
    );
  }
}

@Injectable()
export class ClientCsrfGuard implements CanActivate {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  canActivate(context: ExecutionContext): boolean {
    return assertOriginCsrf(
      context.switchToHttp().getRequest<AuthenticatedRequest>(),
      this.config,
      'client',
    );
  }
}

@Injectable()
export class CoachSignupCsrfGuard implements CanActivate {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return assertOriginCsrf(request, this.config, 'coach');
  }
}

export function authRoleForRequest(request: AuthenticatedRequest) {
  return requestRole(request);
}
