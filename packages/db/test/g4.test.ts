import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { assertRlsContract, auditRlsContract, type SqlClient } from '../src/index';

const databaseUrl = process.env.G4_DATABASE_URL;

if (databaseUrl === undefined || databaseUrl === '') {
  test('G4 PostgreSQL integration gate', { skip: 'G4_DATABASE_URL is not configured' }, () => {});
} else {
  const pool = new Pool({ connectionString: databaseUrl });
  const tenantA = '00000000-0000-7000-8000-000000000001';
  const tenantB = '00000000-0000-7000-8000-000000000002';
  const itemA = '00000000-0000-7000-8000-000000000101';
  const itemB = '00000000-0000-7000-8000-000000000102';
  const parentA = '00000000-0000-7000-8000-000000000201';
  const parentB = '00000000-0000-7000-8000-000000000202';
  const missingParent = '00000000-0000-7000-8000-000000000299';

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

  async function withRuntimeTenant<T>(
    tenantId: string | undefined,
    action: (client: PoolClient) => Promise<T>,
    commit = false,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE traverse_runtime');
      if (tenantId !== undefined) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      }
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
    await pool.query(`
      SET ROLE traverse_ddl;

      CREATE TABLE app.g4_items (
        tenant_id uuid NOT NULL,
        id uuid NOT NULL,
        value text NOT NULL,
        PRIMARY KEY (tenant_id, id)
      );
      ALTER TABLE app.g4_items ENABLE ROW LEVEL SECURITY;
      ALTER TABLE app.g4_items FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON app.g4_items
        FOR ALL
        USING (tenant_id = app.current_tenant_id())
        WITH CHECK (tenant_id = app.current_tenant_id());

      CREATE TABLE app.g4_parents (
        tenant_id uuid NOT NULL,
        id uuid NOT NULL,
        value text NOT NULL,
        PRIMARY KEY (tenant_id, id)
      );
      ALTER TABLE app.g4_parents ENABLE ROW LEVEL SECURITY;
      ALTER TABLE app.g4_parents FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON app.g4_parents
        FOR ALL
        USING (tenant_id = app.current_tenant_id())
        WITH CHECK (tenant_id = app.current_tenant_id());

      CREATE TABLE app.g4_children (
        tenant_id uuid NOT NULL,
        id uuid NOT NULL,
        parent_id uuid NOT NULL,
        value text NOT NULL,
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id, parent_id)
          REFERENCES app.g4_parents (tenant_id, id)
      );
      ALTER TABLE app.g4_children ENABLE ROW LEVEL SECURITY;
      ALTER TABLE app.g4_children FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON app.g4_children
        FOR ALL
        USING (tenant_id = app.current_tenant_id())
        WITH CHECK (tenant_id = app.current_tenant_id());

      RESET ROLE;
    `);

    await withRuntimeTenant(
      tenantA,
      async (client) => {
        await client.query('INSERT INTO app.g4_items (tenant_id, id, value) VALUES ($1, $2, $3)', [
          tenantA,
          itemA,
          'tenant-a',
        ]);
        await client.query(
          'INSERT INTO app.g4_parents (tenant_id, id, value) VALUES ($1, $2, $3)',
          [tenantA, parentA, 'tenant-a-parent'],
        );
      },
      true,
    );

    await withRuntimeTenant(
      tenantB,
      async (client) => {
        await client.query('INSERT INTO app.g4_items (tenant_id, id, value) VALUES ($1, $2, $3)', [
          tenantB,
          itemB,
          'tenant-b',
        ]);
        await client.query(
          'INSERT INTO app.g4_parents (tenant_id, id, value) VALUES ($1, $2, $3)',
          [tenantB, parentB, 'tenant-b-parent'],
        );
      },
      true,
    );
  });

  after(async () => {
    await removeFixture();
    await pool.end();
  });

  test('G4 accepts tenant tables and least-privilege roles that satisfy the contract', async () => {
    await assertRlsContract(auditClient, {
      schema: 'app',
      tenantTables: ['g4_items', 'g4_parents', 'g4_children'],
    });
  });

  test('G4 fails closed when tenant context is missing', async () => {
    await withRuntimeTenant(undefined, async (client) => {
      const visible = await client.query('SELECT id FROM app.g4_items');
      assert.equal(visible.rowCount, 0);

      const insertState = await sqlState(() =>
        client.query('INSERT INTO app.g4_items (tenant_id, id, value) VALUES ($1, $2, $3)', [
          tenantA,
          '00000000-0000-7000-8000-000000000103',
          'missing-context',
        ]),
      );
      assert.equal(insertState, '42501');
    });
  });

  test('G4 blocks cross-tenant read, update, delete, and insert operations', async () => {
    await withRuntimeTenant(tenantA, async (client) => {
      const visible = await client.query<{ id: string }>('SELECT id FROM app.g4_items ORDER BY id');
      assert.deepEqual(visible.rows, [{ id: itemA }]);

      const update = await client.query('UPDATE app.g4_items SET value = $1 WHERE id = $2', [
        'cross-tenant-update',
        itemB,
      ]);
      assert.equal(update.rowCount, 0);

      const deletion = await client.query('DELETE FROM app.g4_items WHERE id = $1', [itemB]);
      assert.equal(deletion.rowCount, 0);

      const insertState = await sqlState(() =>
        client.query('INSERT INTO app.g4_items (tenant_id, id, value) VALUES ($1, $2, $3)', [
          tenantB,
          '00000000-0000-7000-8000-000000000104',
          'cross-tenant-insert',
        ]),
      );
      assert.equal(insertState, '42501');
    });
  });

  test('G4 composite foreign keys do not reveal cross-tenant parent existence', async () => {
    const existingOtherTenantState = await withRuntimeTenant(tenantA, (client) =>
      sqlState(() =>
        client.query(
          'INSERT INTO app.g4_children (tenant_id, id, parent_id, value) VALUES ($1, $2, $3, $4)',
          [tenantA, '00000000-0000-7000-8000-000000000301', parentB, 'other-tenant-parent'],
        ),
      ),
    );
    const nonexistentParentState = await withRuntimeTenant(tenantA, (client) =>
      sqlState(() =>
        client.query(
          'INSERT INTO app.g4_children (tenant_id, id, parent_id, value) VALUES ($1, $2, $3, $4)',
          [tenantA, '00000000-0000-7000-8000-000000000302', missingParent, 'missing-parent'],
        ),
      ),
    );

    assert.equal(existingOtherTenantState, '23503');
    assert.equal(nonexistentParentState, '23503');
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
