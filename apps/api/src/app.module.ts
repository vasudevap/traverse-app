import { type DynamicModule, Module } from '@nestjs/common';
import type { AuthSessionStore } from '@traverse/db';
import { AUTH_CONFIG, type AuthConfig } from './auth-config.js';
import { AuthController } from './auth.controller.js';
import { AuthenticatedSessionGuard, OriginCsrfGuard } from './auth.guards.js';
import { AUTH_SESSION_STORE, AuthService } from './auth.service.js';
import { HealthController } from './health.controller.js';

/**
 * Modular monolith root (Decision D18). Domain modules (auth, tenancy, video,
 * payments-flow-a, billing-flow-b, ...) mount here as they are built.
 */
@Module({})
export class AppModule {
  static register(authSessionStore: AuthSessionStore, authConfig: AuthConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuthController, HealthController],
      providers: [
        { provide: AUTH_SESSION_STORE, useValue: authSessionStore },
        { provide: AUTH_CONFIG, useValue: authConfig },
        AuthService,
        AuthenticatedSessionGuard,
        OriginCsrfGuard,
      ],
    };
  }
}
