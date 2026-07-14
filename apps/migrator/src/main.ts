import { createDatabase, migrateToLatest } from '@traverse/db';

interface DatabaseSecret {
  database: string;
  host: string;
  password: string;
  port: number;
  sslmode: 'verify-full';
  username: string;
}

function readDatabaseSecret(rawSecret: string | undefined): DatabaseSecret {
  if (rawSecret === undefined) {
    throw new Error('DATABASE_MIGRATION_SECRET is required.');
  }

  const parsed: unknown = JSON.parse(rawSecret);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Partial<DatabaseSecret>).host !== 'string' ||
    typeof (parsed as Partial<DatabaseSecret>).port !== 'number' ||
    typeof (parsed as Partial<DatabaseSecret>).database !== 'string' ||
    typeof (parsed as Partial<DatabaseSecret>).username !== 'string' ||
    typeof (parsed as Partial<DatabaseSecret>).password !== 'string' ||
    (parsed as Partial<DatabaseSecret>).sslmode !== 'verify-full'
  ) {
    throw new Error('DATABASE_MIGRATION_SECRET has an invalid database credential shape.');
  }

  return parsed as DatabaseSecret;
}

async function main(): Promise<void> {
  const secret = readDatabaseSecret(process.env.DATABASE_MIGRATION_SECRET);
  const connectionUrl = new URL(
    `postgresql://${encodeURIComponent(secret.username)}:${encodeURIComponent(secret.password)}@${secret.host}:${secret.port}/${secret.database}`,
  );
  const database = createDatabase({
    connectionString: connectionUrl.toString(),
    ssl: { rejectUnauthorized: true },
  });

  try {
    const results = await migrateToLatest(database);
    console.log(`Database migration completed: ${results.length} migration(s) evaluated.`);
  } finally {
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error('Database migration failed.', error);
  process.exitCode = 1;
});
