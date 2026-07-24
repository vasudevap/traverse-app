import { createDatabase, migrateToLatest } from '@traverse/db';
import { databaseConnectionString, initializeJobInfrastructure } from '@traverse/jobs';
import { resetNonprodTestData } from './reset-nonprod-test-data.js';

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
    if (process.argv[2] === 'reset-nonprod-test-data') {
      const counts = await resetNonprodTestData(database);
      console.log(`NonProd test-data reset completed: ${JSON.stringify(counts)}`);
      return;
    }

    if (process.argv[2] !== undefined) {
      throw new Error(`Unknown migrator command: ${process.argv[2]}`);
    }

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
