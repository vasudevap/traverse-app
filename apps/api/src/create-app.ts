import type { NestApplicationOptions } from '@nestjs/common';
import { KMSClient } from '@aws-sdk/client-kms';
import { S3Client } from '@aws-sdk/client-s3';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createDatabase,
  databaseConnectionString,
  DatabaseAuthSessionStore,
  type AuthSessionStore,
} from '@traverse/db';
import {
  createJobBoss,
  databaseConnectionString as jobDatabaseConnectionString,
} from '@traverse/jobs';
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
import {
  DatabaseClientOnboardingStore,
  KmsIntakeAnswerEncryptor,
} from './client-onboarding-store.js';
import type { ClientOnboardingStore } from './client-onboarding.service.js';
import { DatabaseCoachingLoopStore, KmsRelationshipNotesCipher } from './coaching-loop-store.js';
import type { CoachingLoopStore } from './coaching-loop.service.js';
import {
  DatabaseDataPortabilityStore,
  KmsDataPortabilityNotesCipher,
  S3DataPortabilityAssetStore,
} from './data-portability-store.js';
import type {
  DataPortabilityAssetStore,
  DataPortabilityStore,
} from './data-portability.service.js';

export interface AppDependencies {
  allowedOrigins: ReadonlySet<string>;
  authSessionStore: AuthSessionStore;
  clientOnboardingStore?: ClientOnboardingStore;
  coachingLoopStore?: CoachingLoopStore;
  dataPortabilityAssets?: DataPortabilityAssetStore;
  dataPortabilityStore?: DataPortabilityStore;
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

const missingClientOnboardingStore: ClientOnboardingStore = {
  acceptInvite: async () => missingSignupDependency('clientOnboardingStore'),
  countersignContract: async () => missingSignupDependency('clientOnboardingStore'),
  createInvite: async () => missingSignupDependency('clientOnboardingStore'),
  declineInvite: async () => missingSignupDependency('clientOnboardingStore'),
  getCoachContract: async () => missingSignupDependency('clientOnboardingStore'),
  getInviteOptions: async () => missingSignupDependency('clientOnboardingStore'),
  getOnboarding: async () => missingSignupDependency('clientOnboardingStore'),
  inspectInvite: async () => missingSignupDependency('clientOnboardingStore'),
  resendInvite: async () => missingSignupDependency('clientOnboardingStore'),
  revokeInvite: async () => missingSignupDependency('clientOnboardingStore'),
  signContract: async () => missingSignupDependency('clientOnboardingStore'),
  submitIntake: async () => missingSignupDependency('clientOnboardingStore'),
};

const nestLifecycleProperties = new Set<PropertyKey>([
  'beforeApplicationShutdown',
  'onApplicationBootstrap',
  'onApplicationShutdown',
  'onModuleDestroy',
  'onModuleInit',
  'then',
]);
const missingCoachingLoopStore = new Proxy({} as CoachingLoopStore, {
  get: (_target, property) =>
    nestLifecycleProperties.has(property)
      ? undefined
      : async () => missingSignupDependency('coachingLoopStore'),
});
const missingDataPortabilityStore = new Proxy({} as DataPortabilityStore, {
  get: (_target, property) =>
    nestLifecycleProperties.has(property)
      ? undefined
      : async () => missingSignupDependency('dataPortabilityStore'),
});
const missingDataPortabilityAssets: DataPortabilityAssetStore = {
  createDownloadUrl: async () => missingSignupDependency('dataPortabilityAssets'),
};

async function environmentDependencies(): Promise<AppDependencies> {
  const database = createDatabase({
    connectionString: databaseConnectionString(process.env.DATABASE_SECRET),
    ssl: { rejectUnauthorized: true },
  });
  const appBaseUrl = process.env.COACH_APP_BASE_URL ?? 'https://app.traversecoaching.com';
  const clientAppBaseUrl = process.env.CLIENT_APP_BASE_URL ?? 'https://client.traversecoaching.com';
  const kmsKeyId = configuredKmsKeyId();
  const assetBucket = process.env.ASSET_BUCKET_NAME;
  if (assetBucket === undefined || assetBucket.trim() === '') {
    throw new Error('ASSET_BUCKET_NAME is required.');
  }
  const boss = createJobBoss({
    connectionString: jobDatabaseConnectionString(process.env.DATABASE_SECRET),
    ssl: { rejectUnauthorized: true },
  });
  await boss.start();
  const kms = new KMSClient({});
  const s3 = new S3Client({});
  return {
    allowedOrigins: configuredAllowedOrigins(
      process.env.AUTH_ALLOWED_ORIGINS,
      process.env.DEPLOYMENT_ENVIRONMENT,
    ),
    authSessionStore: new DatabaseAuthSessionStore(database),
    clientOnboardingStore: new DatabaseClientOnboardingStore(
      database,
      boss,
      new KmsIntakeAnswerEncryptor(kms),
      {
        clientAppBaseUrl,
        coachAppBaseUrl: appBaseUrl,
        emailFrom: process.env.CLIENT_EMAIL_FROM ?? 'Traverse <no-reply@mail.traversecoaching.com>',
      },
    ),
    coachingLoopStore: new DatabaseCoachingLoopStore(
      database,
      boss,
      new KmsRelationshipNotesCipher(kms),
      {
        clientAppBaseUrl,
        coachAppBaseUrl: appBaseUrl,
        emailFrom: process.env.CLIENT_EMAIL_FROM ?? 'Traverse <no-reply@mail.traversecoaching.com>',
      },
    ),
    dataPortabilityAssets: new S3DataPortabilityAssetStore(s3, assetBucket),
    dataPortabilityStore: new DatabaseDataPortabilityStore(
      database,
      boss,
      new KmsDataPortabilityNotesCipher(kms),
    ),
    signupBillingClient: new StripeFlowBBillingClient(process.env.STRIPE_SECRET),
    signupEmailSender: new ResendSignupEmailSender(
      process.env.RESEND_SECRET,
      appBaseUrl,
      process.env.SIGNUP_EMAIL_FROM ?? 'Traverse <hello@mail.traversecoaching.com>',
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
  const resolvedDependencies = dependencies ?? (await environmentDependencies());
  const app = await NestFactory.create<NestExpressApplication>(
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
      {
        store: resolvedDependencies.clientOnboardingStore ?? missingClientOnboardingStore,
      },
      {
        store: resolvedDependencies.coachingLoopStore ?? missingCoachingLoopStore,
      },
      {
        assets: resolvedDependencies.dataPortabilityAssets ?? missingDataPortabilityAssets,
        store: resolvedDependencies.dataPortabilityStore ?? missingDataPortabilityStore,
      },
    ),
    { ...options, bodyParser: false, rawBody: true },
  );
  app.useBodyParser('json', { limit: '3mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '100kb' });
  app.enableCors({
    credentials: true,
    maxAge: 600,
    origin: [...resolvedDependencies.allowedOrigins],
  });
  return app;
}
