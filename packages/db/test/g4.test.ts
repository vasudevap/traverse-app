import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, type PoolClient } from 'pg';
import {
  assertRlsContract,
  DatabaseAuthSessionStore,
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
  const runtimePool = new Pool({
    connectionString: databaseUrl,
    options: '-c role=traverse_runtime',
  });
  const runtimeDatabase = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: runtimePool }),
  });

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
  const contractTemplateA = '00000000-0000-7000-8000-000000000401';
  const intakeFormA = '00000000-0000-7000-8000-000000000402';
  const appointmentTypeA = '00000000-0000-7000-8000-000000000403';
  const availabilityWindowA = '00000000-0000-7000-8000-000000000404';
  const taskA = '00000000-0000-7000-8000-000000000405';
  const appointmentTypeOtherCoachA = '00000000-0000-7000-8000-000000000406';
  const availabilityWindowOtherCoachA = '00000000-0000-7000-8000-000000000407';

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

    const seedClient = await pool.connect();
    try {
      await seedClient.query('BEGIN');
      await seedClient.query(
        `
        INSERT INTO app.users (id, email, name) VALUES
          ($1, 'owner-a@example.test', 'Owner A'),
          ($2, 'coach-a@example.test', 'Coach A'),
          ($3, 'coach-b@example.test', 'Coach B'),
          ($4, 'client-a@example.test', 'Client A'),
          ($5, 'client-a2@example.test', 'Client A2'),
          ($6, 'client-b@example.test', 'Client B')
      `,
        [ownerUserA, coachUserA, coachUserB, clientUserA, clientUserA2, clientUserB],
      );
      await seedClient.query('UPDATE app.users SET password_hash = $1 WHERE id = $2', [
        'database-backed-test-hash',
        ownerUserA,
      ]);
      await seedClient.query(
        `
        INSERT INTO app.tenants (id, name, subdomain) VALUES
          ($1, 'Tenant A', 'tenant-a'),
          ($2, 'Tenant B', 'tenant-b')
      `,
        [tenantA, tenantB],
      );
      await seedClient.query(
        `
        INSERT INTO app.tenant_keys
          (tenant_id, wrapped_data_key, kms_key_id, key_version)
        VALUES
          ($1, decode('a1', 'hex'), 'alias/traverse-test', 1),
          ($2, decode('b1', 'hex'), 'alias/traverse-test', 1)
      `,
        [tenantA, tenantB],
      );
      await seedClient.query(
        `
        INSERT INTO app.coaches
          (id, tenant_id, user_id, role_in_practice, display_name)
        VALUES
          ($1, $2, $3, 'owner', 'Owner A'),
          ($4, $2, $5, 'coach', 'Coach A'),
          ($6, $7, $8, 'coach', 'Coach B')
      `,
        [
          ownerCoachA,
          tenantA,
          ownerUserA,
          regularCoachA,
          coachUserA,
          regularCoachB,
          tenantB,
          coachUserB,
        ],
      );
      await seedClient.query(
        `
        INSERT INTO app.clients (id, user_id, name) VALUES
          ($1, $2, 'Client A'),
          ($3, $4, 'Client A2'),
          ($5, $6, 'Client B')
      `,
        [clientA, clientUserA, clientA2, clientUserA2, clientB, clientUserB],
      );
      await seedClient.query(
        `
        INSERT INTO app.coaching_relationships
          (id, tenant_id, coach_id, client_id, status, onboarding_state)
        VALUES
          ($1, $2, $3, $4, 'active', 'complete'),
          ($5, $2, $6, $7, 'active', 'complete'),
          ($8, $9, $10, $11, 'active', 'complete')
      `,
        [
          relationshipAOwner,
          tenantA,
          ownerCoachA,
          clientA,
          relationshipACoach,
          regularCoachA,
          clientA2,
          relationshipB,
          tenantB,
          regularCoachB,
          clientB,
        ],
      );
      await seedClient.query(
        `
        INSERT INTO app.contract_templates
          (id, tenant_id, coach_id, name, version, body)
        VALUES
          ($1, $2, $3, 'Foundation contract', 1, 'Signed service agreement snapshot')
      `,
        [contractTemplateA, tenantA, ownerCoachA],
      );
      await seedClient.query(
        `
        INSERT INTO app.intake_forms
          (id, tenant_id, coach_id, name, version, form_schema)
        VALUES
          ($1, $2, $3, 'Foundation intake', 1, '{"type":"object"}'::jsonb)
      `,
        [intakeFormA, tenantA, ownerCoachA],
      );
      await seedClient.query(
        `
        UPDATE app.coaching_relationships
        SET contract_template_id = $1, intake_form_id = $2
        WHERE id = $3
      `,
        [contractTemplateA, intakeFormA, relationshipAOwner],
      );
      await seedClient.query(
        `
        INSERT INTO app.appointment_types
          (id, tenant_id, coach_id, name, default_duration_minutes, self_bookable)
        VALUES
          ($1, $2, $3, 'Coaching session', 60, true),
          ($4, $2, $5, 'Other coach session', 60, true)
      `,
        [appointmentTypeA, tenantA, ownerCoachA, appointmentTypeOtherCoachA, regularCoachA],
      );
      await seedClient.query(
        `
        INSERT INTO app.availability_windows
          (
            id, tenant_id, coach_id, window_type, slot_starts_at, slot_ends_at,
            timezone
          )
        VALUES
          (
            $1, $2, $3, 'slot', '2035-08-03T15:00:00.000Z',
            '2035-08-03T16:00:00.000Z', 'America/Toronto'
          ),
          (
            $4, $2, $5, 'slot', '2035-08-03T17:00:00.000Z',
            '2035-08-03T18:00:00.000Z', 'America/Toronto'
          )
      `,
        [availabilityWindowA, tenantA, ownerCoachA, availabilityWindowOtherCoachA, regularCoachA],
      );
      await seedClient.query(
        `
        INSERT INTO app.tasks
          (id, tenant_id, relationship_id, title, description)
        VALUES
          ($1, $2, $3, 'Complete prep', 'Bring one coaching goal.')
      `,
        [taskA, tenantA, relationshipAOwner],
      );
      await seedClient.query('COMMIT');
    } catch (error) {
      await seedClient.query('ROLLBACK');
      throw error;
    } finally {
      seedClient.release();
    }
  });

  after(async () => {
    await runtimeDatabase.destroy();
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
      appendOnlyTables: [
        'contract_instances',
        'contract_signatures',
        'event_log',
        'legal_acceptances',
      ],
      readOnlyTables: ['auth_subjects', 'billing_plans', 'legal_documents', 'tenant_keys'],
      schema: 'app',
      tenantTables: [...CORE_TENANT_TABLES],
    });
  });

  test('TRA-29 persists hashed sessions, resolves coach context, and revokes immediately', async () => {
    const store = new DatabaseAuthSessionStore(runtimeDatabase);
    const subject = await store.findSubject('owner-a@example.test', 'coach');
    assert.deepEqual(subject, {
      clientId: null,
      coachId: ownerCoachA,
      email: 'owner-a@example.test',
      name: 'Owner A',
      passwordHash: 'database-backed-test-hash',
      practiceRole: 'owner',
      role: 'coach',
      status: 'active',
      tenantId: tenantA,
      userId: ownerUserA,
    });

    const tokenHash = createHash('sha256').update('raw-session-token').digest();
    const now = new Date('2026-07-15T12:00:00.000Z');
    await store.rotateSession({
      expiresAt: new Date('2026-08-14T12:00:00.000Z'),
      ip: '127.0.0.1',
      role: 'coach',
      tokenHash,
      userAgent: 'node-test',
      userId: ownerUserA,
    });

    const authenticated = await store.validateSession(
      tokenHash,
      'coach',
      7 * 24 * 60 * 60 * 1000,
      now,
    );
    assert.equal(authenticated?.tenantId, tenantA);
    assert.equal(authenticated?.coachId, ownerCoachA);

    const visibleTenants = await withRuntimeContext(
      {
        actorId: authenticated?.userId,
        coachId: authenticated?.coachId ?? undefined,
        practiceRole: authenticated?.practiceRole ?? undefined,
        role: authenticated?.role,
        tenantId: authenticated?.tenantId ?? undefined,
      },
      async (client) => {
        const result = await client.query<{ id: string }>('SELECT id FROM app.tenants');
        return result.rows;
      },
    );
    assert.deepEqual(visibleTenants, [{ id: tenantA }]);

    assert.equal(await store.revokeSession(tokenHash, 'coach', new Date()), true);
    assert.equal(
      await store.validateSession(tokenHash, 'coach', 7 * 24 * 60 * 60 * 1000, new Date()),
      undefined,
    );
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

  test('TRA-40 resolves only valid invite tokens and scopes multi-practice client relationships', async () => {
    const rawToken = 'tra-40-secure-invitation-token';
    const tokenHash = createHash('sha256').update(rawToken).digest();
    const inviteId = await withRuntimeContext(
      ownerContext(),
      async (client) => {
        const inserted = await client.query<{ id: string }>(
          `
            INSERT INTO app.client_invites
              (
                tenant_id, coach_id, client_name, email, token_hash, gate_config,
                contract_template_id, intake_form_id, relationship_id
              )
            VALUES (
              $1, $2, 'Client A', 'tra-40-client@example.test', $3,
              '{"contractRequired":true,"countersignatureRequired":false,"intakeRequired":true,"paymentRequired":false}'::jsonb,
              $4, $5, $6
            )
            RETURNING id
          `,
          [tenantA, ownerCoachA, tokenHash, contractTemplateA, intakeFormA, relationshipAOwner],
        );
        return inserted.rows[0]?.id ?? '';
      },
      true,
    );

    await withRuntimeContext({}, async (client) => {
      await client.query(
        `
          SELECT
            set_config('app.invite_token_hash', $1, true),
            set_config('app.actor_id', $2, true),
            set_config('app.role', 'client', true),
            set_config('app.client_id', $3, true)
        `,
        [tokenHash.toString('hex'), clientUserA, clientA],
      );
      const resolved = await client.query<{
        client_id: string;
        invite_id: string;
        relationship_id: string;
        tenant_id: string;
        user_id: string;
      }>('SELECT * FROM app.resolve_client_invite($1)', [tokenHash]);
      assert.deepEqual(resolved.rows, [
        {
          invite_id: inviteId,
          relationship_id: relationshipAOwner,
          tenant_id: tenantA,
        },
      ]);

      const wrongToken = await client.query('SELECT * FROM app.resolve_client_invite($1)', [
        createHash('sha256').update('wrong-token').digest(),
      ]);
      assert.equal(wrongToken.rowCount, 0);

      const tenant = await client.query<{ tenant_id: string | null }>(
        'SELECT app.client_relationship_tenant($1, $2) AS tenant_id',
        [relationshipAOwner, clientA],
      );
      assert.equal(tenant.rows[0]?.tenant_id, tenantA);
      const crossClient = await client.query<{ tenant_id: string | null }>(
        'SELECT app.client_relationship_tenant($1, $2) AS tenant_id',
        [relationshipAOwner, clientB],
      );
      assert.equal(crossClient.rows[0]?.tenant_id, null);
    });

    const terminalConflict = await withRuntimeContext(ownerContext(), (client) =>
      sqlState(() =>
        client.query(
          `
            UPDATE app.client_invites
            SET accepted_at = now(), declined_at = now()
            WHERE id = $1
          `,
          [inviteId],
        ),
      ),
    );
    assert.equal(terminalConflict, '23514');
  });

  test('TRA-40 client relationship updates require matching onboarding evidence', async () => {
    const skippedGateState = await withRuntimeContext(clientContext(), (client) =>
      sqlState(() =>
        client.query(
          `
            UPDATE app.coaching_relationships
            SET onboarding_state = 'active', status = 'active'
            WHERE id = $1
          `,
          [relationshipAOwner],
        ),
      ),
    );
    assert.equal(skippedGateState, '42501');

    const rewriteState = await withRuntimeContext(clientContext(), (client) =>
      sqlState(() =>
        client.query(
          `
            UPDATE app.coaching_relationships
            SET gate_config = '{"contractRequired":false,"intakeRequired":false}'::jsonb
            WHERE id = $1
          `,
          [relationshipAOwner],
        ),
      ),
    );
    assert.equal(rewriteState, '42501');
  });

  test('TRA-40 archived invitation relationships permit recovery invitations', async () => {
    await withRuntimeContext(ownerContext(), async (client) => {
      const first = await client.query<{ id: string }>(
        `
          INSERT INTO app.coaching_relationships
            (tenant_id, coach_id, client_id, status, onboarding_state)
          VALUES ($1, $2, $3, 'invited', 'invited')
          RETURNING id
        `,
        [tenantA, ownerCoachA, clientA2],
      );
      await client.query(
        `
          UPDATE app.coaching_relationships
          SET archived_at = now(), status = 'revoked', onboarding_state = 'revoked'
          WHERE id = $1
        `,
        [first.rows[0]?.id],
      );
      const replacement = await client.query(
        `
          INSERT INTO app.coaching_relationships
            (tenant_id, coach_id, client_id, status, onboarding_state)
          VALUES ($1, $2, $3, 'invited', 'invited')
        `,
        [tenantA, ownerCoachA, clientA2],
      );
      assert.equal(replacement.rowCount, 1);
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

  test('Stage 2 intake responses store ciphertext and become immutable after submit', async () => {
    await withRuntimeContext(clientContext(), async (client) => {
      const ciphertext = Buffer.from('ciphertext-not-json-or-plaintext-stage2-d21');
      const inserted = await client.query<{ answers_enc: Buffer; answers_key_version: number }>(
        `
          INSERT INTO app.intake_responses
            (
              tenant_id, relationship_id, intake_form_id, form_version, answers_enc,
              answers_key_version
            )
          VALUES ($1, $2, $3, 1, $4, 1)
          RETURNING answers_enc, answers_key_version
        `,
        [tenantA, relationshipAOwner, intakeFormA, ciphertext],
      );

      assert.equal(inserted.rows[0]?.answers_key_version, 1);
      assert.equal(inserted.rows[0]?.answers_enc.toString('utf8').includes('coachingGoal'), false);

      const submitted = await client.query(
        `
          UPDATE app.intake_responses
          SET answers_enc = $1, submitted_at = now()
          WHERE tenant_id = $2 AND relationship_id = $3
        `,
        [Buffer.from('ciphertext-updated-stage2-d21-envelope'), tenantA, relationshipAOwner],
      );
      assert.equal(submitted.rowCount, 1);

      const updateState = await sqlState(() =>
        client.query(
          `
            UPDATE app.intake_responses
            SET answers_enc = $1
            WHERE tenant_id = $2 AND relationship_id = $3
          `,
          [Buffer.from('ciphertext-after-submit-stage2-d21'), tenantA, relationshipAOwner],
        ),
      );
      assert.equal(updateState, '42501');
    });
  });

  test('Stage 2 append-only evidence permits inserts but rejects mutation', async () => {
    await withRuntimeContext(ownerContext(), async (client) => {
      const document = await client.query<{
        document_type: string;
        id: string;
        version: string;
      }>(
        `
          SELECT id, document_type, version
          FROM app.legal_documents
          WHERE document_type = 'coach_terms'
        `,
      );

      const legalAcceptance = await client.query<{ id: string }>(
        `
          INSERT INTO app.legal_acceptances
            (user_id, legal_document_id, document_type, version, user_agent)
          VALUES ($1, $2, $3, $4, 'node-test')
          RETURNING id
        `,
        [
          ownerUserA,
          document.rows[0]?.id,
          document.rows[0]?.document_type,
          document.rows[0]?.version,
        ],
      );
      const legalUpdateState = await sqlState(() =>
        client.query('UPDATE app.legal_acceptances SET user_agent = $1 WHERE id = $2', [
          'changed',
          legalAcceptance.rows[0]?.id,
        ]),
      );
      assert.equal(legalUpdateState, '42501');
    });

    await withRuntimeContext(ownerContext(), async (client) => {
      const contract = await client.query<{ id: string }>(
        `
          INSERT INTO app.contract_instances
            (tenant_id, relationship_id, template_id, template_version, signed_snapshot)
          VALUES ($1, $2, $3, 1, 'Signed service agreement snapshot')
          RETURNING id
        `,
        [tenantA, relationshipAOwner, contractTemplateA],
      );
      const contractUpdateState = await sqlState(() =>
        client.query('UPDATE app.contract_instances SET signed_snapshot = $1 WHERE id = $2', [
          'changed',
          contract.rows[0]?.id,
        ]),
      );
      assert.equal(contractUpdateState, '42501');
    });
  });

  test('Stage 2 legal acceptances must match the accepted document snapshot', async () => {
    const document = await pool.query<{
      document_type: string;
      id: string;
    }>(
      `
        SELECT id, document_type
        FROM app.legal_documents
        WHERE document_type = 'acceptable_use_policy'
      `,
    );

    const mismatchState = await withRuntimeContext(regularCoachContext(), (client) =>
      sqlState(() =>
        client.query(
          `
            INSERT INTO app.legal_acceptances
              (user_id, legal_document_id, document_type, version)
            VALUES ($1, $2, $3, 'wrong-version')
          `,
          [coachUserA, document.rows[0]?.id, document.rows[0]?.document_type],
        ),
      ),
    );
    assert.equal(mismatchState, '23503');
  });

  test('Stage 2 clients can complete tasks but cannot rewrite assignments', async () => {
    await withRuntimeContext(clientContext(), async (client) => {
      const completed = await client.query(
        `
          UPDATE app.tasks
          SET status = 'completed', completed_at = now()
          WHERE id = $1
        `,
        [taskA],
      );
      assert.equal(completed.rowCount, 1);

      const rewriteState = await sqlState(() =>
        client.query('UPDATE app.tasks SET title = $1 WHERE id = $2', ['Changed', taskA]),
      );
      assert.equal(rewriteState, '42501');
    });
  });

  test('TRA-41 clients cannot change task deadlines assigned by their coach', async () => {
    const dueAtState = await withRuntimeContext(clientContext(), (client) =>
      sqlState(() =>
        client.query('UPDATE app.tasks SET due_at = $1 WHERE id = $2', [
          '2026-08-01T12:00:00.000Z',
          taskA,
        ]),
      ),
    );
    assert.equal(dueAtState, '42501');
  });

  test('TRA-41 clients see and hold slots only for their active coach relationship', async () => {
    await withRuntimeContext(clientContext(), async (client) => {
      const types = await client.query<{ id: string }>(
        'SELECT id FROM app.appointment_types ORDER BY id',
      );
      assert.deepEqual(types.rows, [{ id: appointmentTypeA }]);

      const slots = await client.query<{ id: string }>(
        'SELECT id FROM app.availability_windows ORDER BY id',
      );
      assert.deepEqual(slots.rows, [{ id: availabilityWindowA }]);
    });

    const unrelatedState = await withRuntimeContext(clientContext(), (client) =>
      sqlState(() =>
        client.query(
          `
            INSERT INTO app.booking_holds
              (tenant_id, availability_window_id, client_id, starts_at, ends_at, expires_at)
            VALUES (
              $1, $2, $3, '2035-08-03T17:00:00.000Z',
              '2035-08-03T18:00:00.000Z', now() + interval '10 minutes'
            )
          `,
          [tenantA, availabilityWindowOtherCoachA, clientA],
        ),
      ),
    );
    assert.equal(unrelatedState, '42501');

    const mismatchedTimeState = await withRuntimeContext(clientContext(), (client) =>
      sqlState(() =>
        client.query(
          `
            INSERT INTO app.booking_holds
              (tenant_id, availability_window_id, client_id, starts_at, ends_at, expires_at)
            VALUES (
              $1, $2, $3, '2035-08-03T15:05:00.000Z',
              '2035-08-03T16:00:00.000Z', now() + interval '10 minutes'
            )
          `,
          [tenantA, availabilityWindowA, clientA],
        ),
      ),
    );
    assert.equal(mismatchedTimeState, '42501');
  });

  test('TRA-41 client booking requires a live converted hold and canonical type details', async () => {
    const activeHoldState = await withRuntimeContext(clientContext(), async (client) => {
      const hold = await client.query<{ id: string }>(
        `
          INSERT INTO app.booking_holds
            (tenant_id, availability_window_id, client_id, starts_at, ends_at, expires_at)
          VALUES (
            $1, $2, $3, '2035-08-03T15:00:00.000Z',
            '2035-08-03T16:00:00.000Z', now() + interval '10 minutes'
          )
          RETURNING id
        `,
        [tenantA, availabilityWindowA, clientA],
      );
      return sqlState(() =>
        client.query(
          `
            INSERT INTO app.appointments
              (
                tenant_id, coach_id, relationship_id, appointment_type_id, booking_hold_id,
                booked_by_client_id, title, starts_at, ends_at, timezone, status
              )
            VALUES (
              $1, $2, $3, $4, $5, $6, 'Coaching session',
              '2035-08-03T15:00:00.000Z', '2035-08-03T16:00:00.000Z',
              'America/Toronto', 'booked'
            )
          `,
          [tenantA, ownerCoachA, relationshipAOwner, appointmentTypeA, hold.rows[0]?.id, clientA],
        ),
      );
    });
    assert.equal(activeHoldState, '42501');

    const untrustedTypeState = await withRuntimeContext(clientContext(), async (client) => {
      const hold = await client.query<{ id: string }>(
        `
          INSERT INTO app.booking_holds
            (tenant_id, availability_window_id, client_id, starts_at, ends_at, expires_at)
          VALUES (
            $1, $2, $3, '2035-08-03T15:00:00.000Z',
            '2035-08-03T16:00:00.000Z', now() + interval '10 minutes'
          )
          RETURNING id
        `,
        [tenantA, availabilityWindowA, clientA],
      );
      await client.query('UPDATE app.booking_holds SET status = $1 WHERE id = $2', [
        'converted',
        hold.rows[0]?.id,
      ]);
      return sqlState(() =>
        client.query(
          `
            INSERT INTO app.appointments
              (
                tenant_id, coach_id, relationship_id, appointment_type_id, booking_hold_id,
                booked_by_client_id, title, starts_at, ends_at, timezone, status
              )
            VALUES (
              $1, $2, $3, $4, $5, $6, 'Untrusted title',
              '2035-08-03T15:00:00.000Z', '2035-08-03T16:00:00.000Z',
              'America/Toronto', 'booked'
            )
          `,
          [
            tenantA,
            ownerCoachA,
            relationshipAOwner,
            appointmentTypeOtherCoachA,
            hold.rows[0]?.id,
            clientA,
          ],
        ),
      );
    });
    assert.equal(untrustedTypeState, '42501');

    await withRuntimeContext(clientContext(), async (client) => {
      const hold = await client.query<{ id: string }>(
        `
          INSERT INTO app.booking_holds
            (tenant_id, availability_window_id, client_id, starts_at, ends_at, expires_at)
          VALUES (
            $1, $2, $3, '2035-08-03T15:00:00.000Z',
            '2035-08-03T16:00:00.000Z', now() + interval '10 minutes'
          )
          RETURNING id
        `,
        [tenantA, availabilityWindowA, clientA],
      );
      await client.query('UPDATE app.booking_holds SET status = $1 WHERE id = $2', [
        'converted',
        hold.rows[0]?.id,
      ]);
      const appointment = await client.query<{ id: string }>(
        `
          INSERT INTO app.appointments
            (
              tenant_id, coach_id, relationship_id, appointment_type_id, booking_hold_id,
              booked_by_client_id, title, starts_at, ends_at, timezone, status
            )
          VALUES (
            $1, $2, $3, $4, $5, $6, 'Coaching session',
            '2035-08-03T15:00:00.000Z', '2035-08-03T16:00:00.000Z',
            'America/Toronto', 'booked'
          )
          RETURNING id
        `,
        [tenantA, ownerCoachA, relationshipAOwner, appointmentTypeA, hold.rows[0]?.id, clientA],
      );
      assert.equal(appointment.rowCount, 1);
    });
  });

  test('Stage 2 booking holds and appointments reject double-booked slots', async () => {
    await withRuntimeContext(clientContext(), async (client) => {
      await client.query(
        `
          INSERT INTO app.booking_holds
            (
              tenant_id, availability_window_id, client_id, starts_at, ends_at,
              expires_at
            )
          VALUES (
            $1, $2, $3, '2035-08-03T15:00:00.000Z',
            '2035-08-03T16:00:00.000Z', now() + interval '10 minutes'
          )
        `,
        [tenantA, availabilityWindowA, clientA],
      );

      const duplicateHoldState = await sqlState(() =>
        client.query(
          `
            INSERT INTO app.booking_holds
              (
                tenant_id, availability_window_id, client_id, starts_at, ends_at,
                expires_at
              )
            VALUES (
              $1, $2, $3, '2035-08-03T15:00:00.000Z',
              '2035-08-03T16:00:00.000Z', now() + interval '10 minutes'
            )
          `,
          [tenantA, availabilityWindowA, clientA],
        ),
      );
      assert.equal(duplicateHoldState, '23505');
    });

    await withRuntimeContext(ownerContext(), async (client) => {
      await client.query(
        `
          INSERT INTO app.appointments
            (
              tenant_id, coach_id, relationship_id, appointment_type_id, title,
              starts_at, ends_at
            )
          VALUES (
            $1, $2, $3, $4, 'Coaching session',
            '2026-08-04T15:00:00.000Z', '2026-08-04T16:00:00.000Z'
          )
        `,
        [tenantA, ownerCoachA, relationshipAOwner, appointmentTypeA],
      );

      const overlapState = await sqlState(() =>
        client.query(
          `
            INSERT INTO app.appointments
              (
                tenant_id, coach_id, relationship_id, appointment_type_id, title,
                starts_at, ends_at
              )
            VALUES (
              $1, $2, $3, $4, 'Overlapping session',
              '2026-08-04T15:30:00.000Z', '2026-08-04T16:30:00.000Z'
            )
          `,
          [tenantA, ownerCoachA, relationshipAOwner, appointmentTypeA],
        ),
      );
      assert.equal(overlapState, '23P01');
    });
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

  test('TRA-42 import and export records bind to the requester and preserve import provenance', async () => {
    const importId = '00000000-0000-7000-8000-000000000501';
    const exportId = '00000000-0000-7000-8000-000000000502';
    const relationshipId = '00000000-0000-7000-8000-000000000503';
    const importedUserId = '00000000-0000-7000-8000-000000000504';
    const importedClientId = '00000000-0000-7000-8000-000000000505';
    try {
      await withRuntimeContext(
        regularCoachContext(),
        async (client) => {
          await client.query(
            `
              INSERT INTO app.users (id, email, name, status)
              VALUES ($1, 'imported@example.test', 'Imported Client', 'imported')
            `,
            [importedUserId],
          );
          await client.query(
            `
              INSERT INTO app.clients (id, user_id, name)
              VALUES ($1, $2, 'Imported Client')
            `,
            [importedClientId, importedUserId],
          );
          await client.query(
            `
              INSERT INTO app.imports
                (id, tenant_id, requested_by, source_type, source_ref, status)
              VALUES ($1, $2, $3, 'csv_clients', 'inline-sha256:test', 'processing')
            `,
            [importId, tenantA, coachUserA],
          );
          await client.query(
            `
              INSERT INTO app.exports (id, tenant_id, requested_by, scope)
              VALUES ($1, $2, $3, 'everything')
            `,
            [exportId, tenantA, coachUserA],
          );
          await client.query(
            `
              INSERT INTO app.coaching_relationships
                (
                  id, tenant_id, coach_id, client_id, status, onboarding_state,
                  tags, source_import_id
                )
              VALUES ($1, $2, $3, $4, 'imported', 'imported', $5, $6)
            `,
            [relationshipId, tenantA, regularCoachA, importedClientId, ['leadership'], importId],
          );
        },
        true,
      );

      const ownerVisible = await withRuntimeContext(ownerContext(), async (client) => {
        const imports = await client.query<{ id: string }>(
          'SELECT id FROM app.imports WHERE id = $1',
          [importId],
        );
        const exports = await client.query<{ id: string }>(
          'SELECT id FROM app.exports WHERE id = $1',
          [exportId],
        );
        return { exports: exports.rows, imports: imports.rows };
      });
      assert.deepEqual(ownerVisible, {
        exports: [{ id: exportId }],
        imports: [{ id: importId }],
      });

      const provenance = await withRuntimeContext(regularCoachContext(), async (client) => {
        const result = await client.query<{ source_import_id: string; tags: string[] }>(
          'SELECT source_import_id, tags FROM app.coaching_relationships WHERE id = $1',
          [relationshipId],
        );
        return result.rows[0];
      });
      assert.deepEqual(provenance, { source_import_id: importId, tags: ['leadership'] });

      const provenanceRewriteState = await withRuntimeContext(regularCoachContext(), (client) =>
        sqlState(() =>
          client.query(
            'UPDATE app.coaching_relationships SET source_import_id = NULL WHERE id = $1',
            [relationshipId],
          ),
        ),
      );
      assert.equal(provenanceRewriteState, '42501');

      const spoofedRequesterState = await withRuntimeContext(regularCoachContext(), (client) =>
        sqlState(() =>
          client.query(
            `
              INSERT INTO app.exports (tenant_id, requested_by, scope)
              VALUES ($1, $2, 'everything')
            `,
            [tenantA, ownerUserA],
          ),
        ),
      );
      assert.equal(spoofedRequesterState, '42501');

      const clientInsertState = await withRuntimeContext(clientContext(), (client) =>
        sqlState(() =>
          client.query(
            `
              INSERT INTO app.imports
                (tenant_id, requested_by, source_type, source_ref, status)
              VALUES ($1, $2, 'csv_clients', 'inline-sha256:test', 'processing')
            `,
            [tenantA, clientUserA],
          ),
        ),
      );
      assert.equal(clientInsertState, '42501');
    } finally {
      await pool.query('DELETE FROM app.coaching_relationships WHERE id = $1', [relationshipId]);
      await pool.query('DELETE FROM app.exports WHERE id = $1', [exportId]);
      await pool.query('DELETE FROM app.imports WHERE id = $1', [importId]);
      await pool.query('DELETE FROM app.clients WHERE id = $1', [importedClientId]);
      await pool.query('DELETE FROM app.users WHERE id = $1', [importedUserId]);
    }
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
