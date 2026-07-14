export interface SqlClient {
  query<Row extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

export interface RlsAuditOptions {
  schema: string;
  tenantTables: string[];
  runtimeRole?: string;
  ddlRole?: string;
}

interface TableAuditRow {
  table_name: string;
  owner_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  tenant_id_not_null: boolean;
  tenant_leading_index: boolean;
  policy_count: number;
}

interface RoleAuditRow {
  role_name: string;
  superuser: boolean;
  create_database: boolean;
  create_role: boolean;
  replication: boolean;
  bypass_rls: boolean;
}

interface PrivilegeAuditRow {
  table_name: string;
  can_truncate: boolean;
}

interface OwnedTableRow {
  schema_name: string;
  table_name: string;
}

interface MembershipRow {
  granted_role: string;
}

interface HelperAuditRow {
  owner_name: string;
  security_definer: boolean;
}

const UNSAFE_ROLE_FLAGS: Array<[keyof RoleAuditRow, string]> = [
  ['superuser', 'SUPERUSER'],
  ['create_database', 'CREATEDB'],
  ['create_role', 'CREATEROLE'],
  ['replication', 'REPLICATION'],
  ['bypass_rls', 'BYPASSRLS'],
];

export async function auditRlsContract(
  client: SqlClient,
  options: RlsAuditOptions,
): Promise<string[]> {
  const runtimeRole = options.runtimeRole ?? 'traverse_runtime';
  const ddlRole = options.ddlRole ?? 'traverse_ddl';
  const tenantTables = [...new Set(options.tenantTables)].sort();
  const errors: string[] = [];

  if (tenantTables.length === 0) {
    return ['G4 requires at least one declared tenant table.'];
  }

  const tableResult = await client.query<TableAuditRow>(
    `
      SELECT
        c.relname AS table_name,
        pg_get_userbyid(c.relowner) AS owner_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        EXISTS (
          SELECT 1
          FROM pg_attribute AS a
          WHERE a.attrelid = c.oid
            AND a.attname = 'tenant_id'
            AND a.attnotnull
            AND NOT a.attisdropped
        ) AS tenant_id_not_null,
        EXISTS (
          SELECT 1
          FROM pg_index AS i
          JOIN pg_attribute AS a
            ON a.attrelid = c.oid
           AND a.attnum = i.indkey[0]
          WHERE i.indrelid = c.oid
            AND i.indisvalid
            AND i.indisready
            AND a.attname = 'tenant_id'
        ) AS tenant_leading_index,
        (SELECT count(*)::integer FROM pg_policy AS p WHERE p.polrelid = c.oid) AS policy_count
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'p')
        AND c.relname = ANY($2::text[])
    `,
    [options.schema, tenantTables],
  );

  const tablesByName = new Map(tableResult.rows.map((row) => [row.table_name, row]));

  for (const tableName of tenantTables) {
    const table = tablesByName.get(tableName);
    const qualifiedName = `${options.schema}.${tableName}`;

    if (table === undefined) {
      errors.push(`${qualifiedName}: declared tenant table does not exist.`);
      continue;
    }
    if (table.owner_name !== ddlRole) {
      errors.push(`${qualifiedName}: owner must be ${ddlRole}, found ${table.owner_name}.`);
    }
    if (!table.tenant_id_not_null) {
      errors.push(`${qualifiedName}: tenant_id must exist and be NOT NULL.`);
    }
    if (!table.tenant_leading_index) {
      errors.push(`${qualifiedName}: a valid index must lead with tenant_id.`);
    }
    if (!table.rls_enabled) {
      errors.push(`${qualifiedName}: row-level security must be enabled.`);
    }
    if (!table.rls_forced) {
      errors.push(`${qualifiedName}: row-level security must be forced.`);
    }
    if (table.policy_count === 0) {
      errors.push(`${qualifiedName}: at least one row-level security policy is required.`);
    }
  }

  const roleResult = await client.query<RoleAuditRow>(
    `
      SELECT
        rolname AS role_name,
        rolsuper AS superuser,
        rolcreatedb AS create_database,
        rolcreaterole AS create_role,
        rolreplication AS replication,
        rolbypassrls AS bypass_rls
      FROM pg_roles
      WHERE rolname = ANY($1::text[])
    `,
    [[runtimeRole, ddlRole]],
  );
  const rolesByName = new Map(roleResult.rows.map((row) => [row.role_name, row]));

  for (const roleName of [runtimeRole, ddlRole]) {
    const role = rolesByName.get(roleName);
    if (role === undefined) {
      errors.push(`Required database role ${roleName} does not exist.`);
      continue;
    }
    for (const [flag, label] of UNSAFE_ROLE_FLAGS) {
      if (role[flag]) {
        errors.push(`${roleName}: unsafe ${label} attribute is enabled.`);
      }
    }
  }

  const schemaPrivilegeResult = await client.query<{ can_create: boolean }>(
    `SELECT has_schema_privilege($1, $2, 'CREATE') AS can_create`,
    [runtimeRole, options.schema],
  );
  if (schemaPrivilegeResult.rows[0]?.can_create) {
    errors.push(`${runtimeRole}: CREATE privilege on schema ${options.schema} is forbidden.`);
  }

  const truncateResult = await client.query<PrivilegeAuditRow>(
    `
      SELECT
        table_name,
        has_table_privilege(
          $1,
          quote_ident($2) || '.' || quote_ident(table_name),
          'TRUNCATE'
        ) AS can_truncate
      FROM unnest($3::text[]) AS table_name
      WHERE to_regclass(quote_ident($2) || '.' || quote_ident(table_name)) IS NOT NULL
    `,
    [runtimeRole, options.schema, tenantTables],
  );
  for (const row of truncateResult.rows) {
    if (row.can_truncate) {
      errors.push(
        `${runtimeRole}: TRUNCATE privilege on ${options.schema}.${row.table_name} is forbidden.`,
      );
    }
  }

  const ownershipResult = await client.query<OwnedTableRow>(
    `
      SELECT n.nspname AS schema_name, c.relname AS table_name
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE pg_get_userbyid(c.relowner) = $1
        AND c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    `,
    [runtimeRole],
  );
  for (const row of ownershipResult.rows) {
    errors.push(`${runtimeRole}: must not own table ${row.schema_name}.${row.table_name}.`);
  }

  const membershipResult = await client.query<MembershipRow>(
    `
      SELECT granted.rolname AS granted_role
      FROM pg_auth_members AS membership
      JOIN pg_roles AS member ON member.oid = membership.member
      JOIN pg_roles AS granted ON granted.oid = membership.roleid
      WHERE member.rolname = $1
    `,
    [runtimeRole],
  );
  for (const row of membershipResult.rows) {
    errors.push(`${runtimeRole}: unexpected membership in role ${row.granted_role}.`);
  }

  const helperResult = await client.query<HelperAuditRow>(
    `
      SELECT pg_get_userbyid(p.proowner) AS owner_name, p.prosecdef AS security_definer
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = $1
        AND p.proname = 'current_tenant_id'
        AND pg_get_function_identity_arguments(p.oid) = ''
    `,
    [options.schema],
  );
  const helper = helperResult.rows[0];
  if (helper === undefined) {
    errors.push(`${options.schema}.current_tenant_id(): required RLS context helper is missing.`);
  } else {
    if (helper.owner_name !== ddlRole) {
      errors.push(`${options.schema}.current_tenant_id(): owner must be ${ddlRole}.`);
    }
    if (helper.security_definer) {
      errors.push(`${options.schema}.current_tenant_id(): SECURITY DEFINER is forbidden.`);
    }
  }

  return errors;
}

export async function assertRlsContract(
  client: SqlClient,
  options: RlsAuditOptions,
): Promise<void> {
  const errors = await auditRlsContract(client, options);
  if (errors.length > 0) {
    throw new Error(`G4 RLS contract failed:\n- ${errors.join('\n- ')}`);
  }
}
