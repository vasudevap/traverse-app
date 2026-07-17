import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  createDatabase,
  databaseConnectionString,
  DatabaseAuthSessionStore,
  type AuthSessionStore,
} from '@traverse/db';
import { AppModule } from './app.module.js';
import { configuredAllowedOrigins } from './auth-config.js';
import {
  AwsTenantKeyGenerator,
  ResendSignupEmailSender,
  StripeFlowBBillingClient,
} from './coach-signup-adapters.js';
import {
  DatabaseCoachSignupStore,
  type CoachSignupStore,
  type FlowBBillingClient,
  type SignupEmailSender,
  type TenantKeyGenerator,
} from './coach-signup.service.js';
import { S3CoachProfileAssetStore } from './coach-setup-assets.js';
import { DatabaseCoachSetupStore } from './coach-setup-store.js';
import type { CoachProfileAssetStore, CoachSetupStore } from './coach-setup.service.js';

export interface AppDependencies {
  allowedOrigins: ReadonlySet<string>;
  authSessionStore: AuthSessionStore;
  setupAssetStore?: CoachProfileAssetStore;
  setupStore?: CoachSetupStore;
  signupBillingClient?: FlowBBillingClient;
  signupEmailSender?: SignupEmailSender;
  signupStore?: CoachSignupStore;
  tenantKeyGenerator?: TenantKeyGenerator;
}

function missingSignupDependency(label: string): never {
  throw new Error(`${label} is required for coach signup routes.`);
}

function configuredKmsKeyId(): string {
  const explicitKeyId = process.env.APP_KMS_KEY_ID;
  if (explicitKeyId !== undefined && explicitKeyId.trim() !== '') {
    return explicitKeyId;
  }
  if (
    process.env.DEPLOYMENT_ENVIRONMENT === 'nonprod' ||
    process.env.DEPLOYMENT_ENVIRONMENT === 'prod'
  ) {
    return `alias/traverse/${process.env.DEPLOYMENT_ENVIRONMENT}/application`;
  }
  throw new Error('APP_KMS_KEY_ID is required when DEPLOYMENT_ENVIRONMENT is not set.');
}

const missingSignupStore: CoachSignupStore = {
  activateVerifiedSignup: async () => missingSignupDependency('signupStore'),
  createPendingSignup: async () => missingSignupDependency('signupStore'),
  findPendingVerification: async () => missingSignupDependency('signupStore'),
  recordFlowBWebhookEvent: async () => missingSignupDependency('signupStore'),
  updateSubscriptionFromWebhook: async () => missingSignupDependency('signupStore'),
};

const missingSetupStore: CoachSetupStore = {
  get: async () => missingSignupDependency('setupStore'),
  markOptionalSkipped: async () => missingSignupDependency('setupStore'),
  markPreviewed: async () => missingSignupDependency('setupStore'),
  saveCoachProfile: async () => missingSignupDependency('setupStore'),
  saveOnboardingDefaults: async () => missingSignupDependency('setupStore'),
  savePolicies: async () => missingSignupDependency('setupStore'),
  savePracticeProfile: async () => missingSignupDependency('setupStore'),
  saveProfilePhoto: async () => missingSignupDependency('setupStore'),
};

const missingSetupAssets: CoachProfileAssetStore = {
  confirmUpload: async () => missingSignupDependency('setupAssetStore'),
  createReadUrl: async () => missingSignupDependency('setupAssetStore'),
  prepareUpload: async () => missingSignupDependency('setupAssetStore'),
};

function environmentDependencies(): AppDependencies {
  const database = createDatabase({
    connectionString: databaseConnectionString(process.env.DATABASE_SECRET),
    ssl: { rejectUnauthorized: true },
  });
  const appBaseUrl = process.env.COACH_APP_BASE_URL ?? 'https://app.traversecoaching.com';
  const kmsKeyId = configuredKmsKeyId();
  const assetBucket = process.env.ASSET_BUCKET_NAME;
  if (assetBucket === undefined || assetBucket.trim() === '') {
    throw new Error('ASSET_BUCKET_NAME is required.');
  }
  return {
    allowedOrigins: configuredAllowedOrigins(
      process.env.AUTH_ALLOWED_ORIGINS,
      process.env.DEPLOYMENT_ENVIRONMENT,
    ),
    authSessionStore: new DatabaseAuthSessionStore(database),
    signupBillingClient: new StripeFlowBBillingClient(process.env.STRIPE_SECRET),
    signupEmailSender: new ResendSignupEmailSender(
      process.env.RESEND_SECRET,
      appBaseUrl,
      process.env.SIGNUP_EMAIL_FROM ?? 'Traverse <hello@traversecoaching.com>',
    ),
    signupStore: new DatabaseCoachSignupStore(database),
    setupAssetStore: new S3CoachProfileAssetStore({ bucket: assetBucket, kmsKeyId }),
    setupStore: new DatabaseCoachSetupStore(database),
    tenantKeyGenerator: new AwsTenantKeyGenerator(kmsKeyId),
  };
}

/** Create the Nest application without binding a port, so boot behavior is testable. */
export async function createApp(
  options: NestApplicationOptions = {},
  dependencies?: AppDependencies,
) {
  const resolvedDependencies = dependencies ?? environmentDependencies();
  const app = await NestFactory.create(
    AppModule.register(
      resolvedDependencies.authSessionStore,
      {
        allowedOrigins: resolvedDependencies.allowedOrigins,
      },
      {
        billingClient: resolvedDependencies.signupBillingClient ?? {
          createTrialSubscription: async () => missingSignupDependency('signupBillingClient'),
          verifyWebhook: async () => missingSignupDependency('signupBillingClient'),
        },
        emailSender: resolvedDependencies.signupEmailSender ?? {
          sendVerificationEmail: async () => missingSignupDependency('signupEmailSender'),
        },
        store: resolvedDependencies.signupStore ?? missingSignupStore,
        tenantKeyGenerator: resolvedDependencies.tenantKeyGenerator ?? {
          generate: async () => missingSignupDependency('tenantKeyGenerator'),
        },
      },
      {
        assets: resolvedDependencies.setupAssetStore ?? missingSetupAssets,
        store: resolvedDependencies.setupStore ?? missingSetupStore,
      },
    ),
    { rawBody: true, ...options },
  );
  app.enableCors({
    credentials: true,
    maxAge: 600,
    origin: [...resolvedDependencies.allowedOrigins],
  });
  return app;
}
