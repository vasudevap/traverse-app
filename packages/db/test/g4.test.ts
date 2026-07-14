import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, type PoolClient } from 'pg';
import {
  assertRlsContract,
  auditRlsContract,
  CORE_TENANT_TABLES,
  migrateToEmpty,
  migrateToLatest,
  withTenantContext,
  type Database,
  type SqlClient,
  type TenantContext,
} from '../src/index';

const databaseUrl = process.env.G4_DATABASE_URL;

if (databaseUrl === undefined || databaseUrl === '') {
  test('G4 PostgreSQL integration gate', { skip: 'G4_DATABASE_URL is not configured' }, () => {});
} else {
  const pool = new Pool({ connectionString: databaseUrl });
  const database = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  const tenantA = '00000000-0000-7000-8000-000000000001';
  const tenantB = '00000000-0000-7000-8000-000000000002';
  const ownerUserA = '00000000-0000-7000-8000-000000000011';
  const coachUserA = '00000000-0000-7000-8000-000000000012';
  const coachUserB = '00000000-0000-7000-8000-000000000013';
  const clientUserA = '00000000-0000-7000-8000-000000000021';
  const clientUserA2 = '00000000-0000-7000-8000-000000000022';
  const clientUserB = '00000000-0000-7000-8000-000000000023';
  const ownerCoachA = '00000000-0000-7000-8000-000000000101';
  const regularCoachA = '00000000-0000-7000-8000-000000000102';
  const regularCoachB = '00000000-0000-7000-8000-000000000103';
  const missingCoach = '00000000-0000-7000-8000-000000000199';
  const clientA = '00000000-0000-7000-8000-000000000201';
  const clientA2 = '00000000-0000-7000-8000-000000000202';
  const clientB = '00000000-0000-7000-8000-000000000203';
  const relationshipAOwner = '00000000-0000-7000-8000-000000000301';
  const relationshipACoach = '00000000-0000-7000-8000-000000000302';
  const relationshipB = '00000000-0000-7000-8000-000000000303';

  const auditClient: SqlClient = {
    async query<Row extends object>(text: string, values?: unknown[]) {
      const result = await pool.query(text, values);
      return { rows: result.rows as Row[] };
    },
  };

  async function removeFixture(): Promise<void> {
    await pool.query('DROP SCHEMA IF EXISTS app CASCADE');

    for (const role of ['traverse_runtime', 'traverse_ddl']) {
      const result = await pool.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists',
        [role],
      );
      if (result.rows[0]?.exists) {
        await pool.query(`DROP OWNED BY ${role}`);
        await pool.query(`DROP ROLE ${role}`);
      }
    }
  }

  async function withRuntimeContext<T>(
    context: Partial<TenantContext>,
    action: (client: PoolClient) => Promise<T>,
    commit = false,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE traverse_runtime');
      await client.query(
        `
          SELECT
            set_config('app.tenant_id', $1, true),
            set_config('app.actor_id', $2, true),
            set_config('app.role', $3, true),
            set_config('app.coach_id', $4, true),
            set_config('app.client_id', $5, true),
            set_config('app.practice_role', $6, true)
        `,
        [
          context.tenantId ?? '',
          context.actorId ?? '',
          context.role ?? '',
          context.coachId ?? '',
          context.clientId ?? '',
          context.practiceRole ?? '',
        ],
      );
      const result = await action(client);
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  function ownerContext(): TenantContext {
    return {
      actorId: ownerUserA,
      coachId: ownerCoachA,
      practiceRole: 'owner',
      role: 'coach',
      tenantId: tenantA,
    };
  }

  function regularCoachContext(): TenantContext {
    return {
      actorId: coachUserA,
      coachId: regularCoachA,
      practiceRole: 'coach',
      role: 'coach',
      tenantId: tenantA,
    };
  }

  function clientContext(): TenantContext {
    return {
      actorId: clientUserA,
      clientId: clientA,
      coachId: ownerCoachA,
      role: 'client',
      tenantId: tenantA,
    };
  }

  async function sqlState(action: () => Promise<unknown>): Promise<string | undefined> {
    try {
      await action();
      return undefined;
    } catch (error) {
      return (error as { code?: string }).code;
    }
  }

  before(async () => {
    await removeFixture();

    const roleSql = await readFile(new URL('../sql/roles-and-rls.sql', import.meta.url), 'utf8');
    await pool.query(roleSql);

    const initialMigration = await migrateToLatest(database);
    assert.equal(initialMigration.at(-1)?.status, 'Success');
    const rollback = await migrateToEmpty(database);
    assert.equal(rollback.at(-1)?.status, 'Success');
    const reappliedMigration = await migrateToLatest(database);
    assert.equal(reappliedMigration.at(-1)?.status, 'Success');

    await pool.query(
      `
        INSERT INTO app.users (id, email, name) VALUES
          ($1, 'owner-a@example.test', 'Owner A'),
          ($2, 'coach-a@example.test', 'Coach A'),
          ($3, 'coach-b@example.test', 'Coach B'),
          ($4, 'client-a@example.test', 'Client A'),
          ($5, 'client-a2@example.test', 'Client A2'),
          ($6, 'client-b@example.test', 'Client B');

        INSERT INTO app.tenants (id, name, subdomain) VALUES
          ($7, 'Tenant A', 'tenant-a'),
          ($8, 'Tenant B', 'tenant-b');

        INSERT INTO app.tenant_keys
          (tenant_id, wrapped_data_key, kms_key_id, key_version)
        VALUES
          ($7, decode('a1', 'hex'), 'alias/traverse-test', 1),
          ($8, decode('b1', 'hex'), 'alias/traverse-test', 1);

        INSERT INTO app.coaches
          (id, tenant_id, user_id, role_in_practice, display_name)
        VALUES
          ($9, $7, $1, 'owner', 'Owner A'),
          ($10, $7, $2, 'coach', 'Coach A'),
          ($11, $8, $3, 'coach', 'Coach B');

        INSERT INTO app.clients (id, user_id, name) VALUES
          ($12, $4, 'Client A'),
          ($13, $5, 'Client A2'),
          ($14, $6, 'Client B');

        INSERT INTO app.coaching_relationships
          (id, tenant_id, coach_id, client_id, status, onboarding_state)
        VALUES
          ($15, $7, $9, $12, 'active', 'complete'),
          ($16, $7, $10, $13, 'active', 'complete'),
          ($17, $8, $11, $14, 'active', 'complete');
      `,
      [
        ownerUserA,
        coachUserA,
        coachUserB,
        clientUserA,
        clientUserA2,
        clientUserB,
        tenantA,
        tenantB,
        ownerCoachA,
        regularCoachA,
        regularCoachB,
        clientA,
        clientA2,
        clientB,
        relationshipAOwner,
        relationshipACoach,
        relationshipB,
      ],
    );
  });

  after(async () => {
    await removeFixture();
    await database.destroy();
  });

  test('TRA-25 migration round-trips and PostgreSQL generates UUIDv7 identifiers', async () => {
    const result = await pool.query<{ id: string; version: number }>(
      `
        INSERT INTO app.users (email, name)
        VALUES ('uuid-v7@example.test', 'UUID V7')
        RETURNING id, uuid_extract_version(id) AS version
      `,
    );

    assert.match(result.rows[0]?.id ?? '', /^[0-9a-f-]{36}$/);
    assert.equal(result.rows[0]?.version, 7);
  });

  test('G4 accepts the core tenant tables and read-only tenant key contract', async () => {
    await assertRlsContract(auditClient, {
      readOnlyTables: ['tenant_keys'],
      schema: 'app',
      tenantTables: [...CORE_TENANT_TABLES],
    });
  });

  test('tenant context helper validates claims and scopes settings to one transaction', async () => {
    const observed = await withTenantContext(
      database,
      regularCoachContext(),
      async (transaction) => {
        const result = await sql<{
          actor_id: string;
          coach_id: string;
          practice_role: string;
          role: string;
          tenant_id: string;
        }>`
        SELECT
          app.current_actor_id()::text AS actor_id,
          app.current_coach_id()::text AS coach_id,
          app.current_practice_role() AS practice_role,
          app.current_actor_role() AS role,
          app.current_tenant_id()::text AS tenant_id
      `.execute(transaction);
        return result.rows[0];
      },
    );

    assert.deepEqual(observed, {
      actor_id: coachUserA,
      coach_id: regularCoachA,
      practice_role: 'coach',
      role: 'coach',
      tenant_id: tenantA,
    });

    await assert.rejects(
      withTenantContext(
        database,
        {
          actorId: coachUserA,
          role: 'coach',
          tenantId: tenantA,
        },
        async () => undefined,
      ),
      /coachId must be a valid UUID/,
    );
  });

  test('G4 fails closed when tenant context is missing', async () => {
    await withRuntimeContext({}, async (client) => {
      const visible = await client.query('SELECT id FROM app.coaching_relationships');
      assert.equal(visible.rowCount, 0);

      const insertState = await sqlState(() =>
        client.query(
          `
            INSERT INTO app.coaching_relationships
              (tenant_id, coach_id, client_id, status, onboarding_state)
            VALUES ($1, $2, $3, 'active', 'complete')
          `,
          [tenantA, ownerCoachA, clientA2],
        ),
      );
      assert.equal(insertState, '42501');
    });
  });

  test('G4 blocks cross-tenant relationship reads, updates, and inserts', async () => {
    await withRuntimeContext(regularCoachContext(), async (client) => {
      const visible = await client.query<{ id: string }>(
        'SELECT id FROM app.coaching_relationships ORDER BY id',
      );
      assert.deepEqual(visible.rows, [{ id: relationshipACoach }]);

      const update = await client.query(
        'UPDATE app.coaching_relationships SET status = $1 WHERE id = $2',
        ['archived', relationshipB],
      );
      assert.equal(update.rowCount, 0);

      const insertState = await sqlState(() =>
        client.query(
          `
            INSERT INTO app.coaching_relationships
              (tenant_id, coach_id, client_id, status, onboarding_state)
            VALUES ($1, $2, $3, 'active', 'complete')
          `,
          [tenantB, regularCoachB, clientA],
        ),
      );
      assert.equal(insertState, '42501');
    });
  });

  test('G4 composite foreign keys do not reveal cross-tenant coach existence', async () => {
    const existingOtherTenantState = await withRuntimeContext(ownerContext(), (client) =>
      sqlState(() =>
        client.query(
          `
            INSERT INTO app.coaching_relationships
              (tenant_id, coach_id, client_id, status, onboarding_state)
            VALUES ($1, $2, $3, 'active', 'complete')
          `,
          [tenantA, regularCoachB, clientA2],
        ),
      ),
    );
    const nonexistentCoachState = await withRuntimeContext(ownerContext(), (client) =>
      sqlState(() =>
        client.query(
          `
            INSERT INTO app.coaching_relationships
              (tenant_id, coach_id, client_id, status, onboarding_state)
            VALUES ($1, $2, $3, 'active', 'complete')
          `,
          [tenantA, missingCoach, clientA2],
        ),
      ),
    );

    assert.equal(existingOtherTenantState, '23503');
    assert.equal(nonexistentCoachState, '23503');
  });

  test('A11 scopes regular coaches, practice owners, and clients correctly', async () => {
    const regularRows = await withRuntimeContext(regularCoachContext(), async (client) => {
      const result = await client.query<{ id: string }>(
        'SELECT id FROM app.coaching_relationships ORDER BY id',
      );
      return result.rows;
    });
    assert.deepEqual(regularRows, [{ id: relationshipACoach }]);

    const ownerRows = await withRuntimeContext(ownerContext(), async (client) => {
      const result = await client.query<{ id: string }>(
        'SELECT id FROM app.coaching_relationships ORDER BY id',
      );
      return result.rows;
    });
    assert.deepEqual(ownerRows, [{ id: relationshipAOwner }, { id: relationshipACoach }]);

    const clientRows = await withRuntimeContext(clientContext(), async (client) => {
      const result = await client.query<{ id: string }>(
        'SELECT id FROM app.coaching_relationships ORDER BY id',
      );
      return result.rows;
    });
    assert.deepEqual(clientRows, [{ id: relationshipAOwner }]);
  });

  test('coach identity and practice role columns cannot be changed by runtime sessions', async () => {
    const roleUpdateState = await withRuntimeContext(regularCoachContext(), (client) =>
      sqlState(() =>
        client.query('UPDATE app.coaches SET role_in_practice = $1 WHERE id = $2', [
          'owner',
          regularCoachA,
        ]),
      ),
    );
    assert.equal(roleUpdateState, '42501');

    const ownerUpdate = await withRuntimeContext(ownerContext(), (client) =>
      client.query('UPDATE app.coaches SET status = $1 WHERE id = $2', ['inactive', regularCoachA]),
    );
    assert.equal(ownerUpdate.rowCount, 1);
  });

  test('tenant keys are tenant-scoped and runtime read-only', async () => {
    const visible = await withRuntimeContext(regularCoachContext(), async (client) => {
      const result = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM app.tenant_keys ORDER BY tenant_id',
      );
      return result.rows;
    });
    assert.deepEqual(visible, [{ tenant_id: tenantA }]);

    const updateState = await withRuntimeContext(ownerContext(), (client) =>
      sqlState(() =>
        client.query('UPDATE app.tenant_keys SET key_version = 2 WHERE tenant_id = $1', [tenantA]),
      ),
    );
    assert.equal(updateState, '42501');
  });

  test('tenant roots are isolated and migration metadata is unavailable to runtime', async () => {
    const visible = await withRuntimeContext(ownerContext(), async (client) => {
      const result = await client.query<{ id: string }>('SELECT id FROM app.tenants ORDER BY id');
      return result.rows;
    });
    assert.deepEqual(visible, [{ id: tenantA }]);

    const metadataState = await withRuntimeContext(ownerContext(), (client) =>
      sqlState(() => client.query('SELECT * FROM app.kysely_migration')),
    );
    assert.equal(metadataState, '42501');
  });

  test('coaching relationships cannot be hard-deleted by runtime sessions', async () => {
    const deleteState = await withRuntimeContext(ownerContext(), (client) =>
      sqlState(() =>
        client.query('DELETE FROM app.coaching_relationships WHERE id = $1', [relationshipAOwner]),
      ),
    );
    assert.equal(deleteState, '42501');
  });

  test('G4 audit reports missing tenant safeguards', async () => {
    await pool.query(`
      SET ROLE traverse_ddl;
      CREATE TABLE app.g4_broken (
        tenant_id uuid,
        id uuid NOT NULL PRIMARY KEY
      );
      RESET ROLE;
    `);

    try {
      const errors = await auditRlsContract(auditClient, {
        schema: 'app',
        tenantTables: ['g4_broken'],
      });
      assert.match(errors.join('\n'), /tenant_id must exist and be NOT NULL/);
      assert.match(errors.join('\n'), /index must lead with tenant_id/);
      assert.match(errors.join('\n'), /row-level security must be enabled/);
      assert.match(errors.join('\n'), /row-level security must be forced/);
      assert.match(errors.join('\n'), /policy is required/);
    } finally {
      await pool.query('DROP TABLE app.g4_broken');
    }
  });
}
