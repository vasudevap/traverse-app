import { type DynamicModule, Module } from '@nestjs/common';
import type { AuthSessionStore } from '@traverse/db';
import { AUTH_CONFIG, type AuthConfig } from './auth-config.js';
import { AuthController } from './auth.controller.js';
import { AuthenticatedSessionGuard, CoachSignupCsrfGuard, OriginCsrfGuard } from './auth.guards.js';
import { AUTH_SESSION_STORE, AuthService } from './auth.service.js';
import { CoachSignupController } from './coach-signup.controller.js';
import { CoachSetupController } from './coach-setup.controller.js';
import {
  COACH_PROFILE_ASSET_STORE,
  COACH_SETUP_STORE,
  type CoachProfileAssetStore,
  type CoachSetupStore,
  CoachSetupService,
} from './coach-setup.service.js';
import {
  COACH_SIGNUP_STORE,
  CoachSignupService,
  FLOW_B_BILLING_CLIENT,
  SIGNUP_EMAIL_SENDER,
  TENANT_KEY_GENERATOR,
  type CoachSignupStore,
  type FlowBBillingClient,
  type SignupEmailSender,
  type TenantKeyGenerator,
} from './coach-signup.service.js';
import { FlowBWebhookController } from './flow-b-webhook.controller.js';
import { HealthController } from './health.controller.js';

/**
 * Modular monolith root (Decision D18). Domain modules (auth, tenancy, video,
 * payments-flow-a, billing-flow-b, ...) mount here as they are built.
 */
@Module({})
export class AppModule {
  static register(
    authSessionStore: AuthSessionStore,
    authConfig: AuthConfig,
    signupDependencies: {
      billingClient: FlowBBillingClient;
      emailSender: SignupEmailSender;
      store: CoachSignupStore;
      tenantKeyGenerator: TenantKeyGenerator;
    },
    setupDependencies: {
      assets: CoachProfileAssetStore;
      store: CoachSetupStore;
    },
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        AuthController,
        CoachSignupController,
        CoachSetupController,
        FlowBWebhookController,
        HealthController,
      ],
      providers: [
        { provide: AUTH_SESSION_STORE, useValue: authSessionStore },
        { provide: AUTH_CONFIG, useValue: authConfig },
        { provide: COACH_SIGNUP_STORE, useValue: signupDependencies.store },
        { provide: FLOW_B_BILLING_CLIENT, useValue: signupDependencies.billingClient },
        { provide: SIGNUP_EMAIL_SENDER, useValue: signupDependencies.emailSender },
        { provide: TENANT_KEY_GENERATOR, useValue: signupDependencies.tenantKeyGenerator },
        { provide: COACH_PROFILE_ASSET_STORE, useValue: setupDependencies.assets },
        { provide: COACH_SETUP_STORE, useValue: setupDependencies.store },
        AuthService,
        CoachSetupService,
        CoachSignupService,
        AuthenticatedSessionGuard,
        CoachSignupCsrfGuard,
        OriginCsrfGuard,
      ],
    };
  }
}
