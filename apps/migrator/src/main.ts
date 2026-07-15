import { createDatabase, migrateToLatest } from '@traverse/db';
import { databaseConnectionString, initializeJobInfrastructure } from '@traverse/jobs';

async function main(): Promise<void> {
  const connectionString = databaseConnectionString(
    process.env.DATABASE_MIGRATION_SECRET,
    'DATABASE_MIGRATION_SECRET',
  );
  const database = createDatabase({
    connectionString,
    ssl: { rejectUnauthorized: true },
  });

  try {
    const results = await migrateToLatest(database);
    await initializeJobInfrastructure({ connectionString, ssl: { rejectUnauthorized: true } });
    console.log(`Database migration completed: ${results.length} migration(s) evaluated.`);
  } finally {
    await database.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error('Database migration failed.', error);
  process.exitCode = 1;
});
