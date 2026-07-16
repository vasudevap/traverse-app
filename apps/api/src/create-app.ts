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

export interface AppDependencies {
  allowedOrigins: ReadonlySet<string>;
  authSessionStore: AuthSessionStore;
}

function environmentDependencies(): AppDependencies {
  const database = createDatabase({
    connectionString: databaseConnectionString(process.env.DATABASE_SECRET),
    ssl: { rejectUnauthorized: true },
  });
  return {
    allowedOrigins: configuredAllowedOrigins(
      process.env.AUTH_ALLOWED_ORIGINS,
      process.env.DEPLOYMENT_ENVIRONMENT,
    ),
    authSessionStore: new DatabaseAuthSessionStore(database),
  };
}

/** Create the Nest application without binding a port, so boot behavior is testable. */
export async function createApp(
  options: NestApplicationOptions = {},
  dependencies?: AppDependencies,
) {
  const resolvedDependencies = dependencies ?? environmentDependencies();
  const app = await NestFactory.create(
    AppModule.register(resolvedDependencies.authSessionStore, {
      allowedOrigins: resolvedDependencies.allowedOrigins,
    }),
    options,
  );
  app.enableCors({
    credentials: true,
    maxAge: 600,
    origin: [...resolvedDependencies.allowedOrigins],
  });
  return app;
}
