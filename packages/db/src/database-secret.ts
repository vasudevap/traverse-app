interface DatabaseSecret {
  database: string;
  host: string;
  password: string;
  port: number;
  sslmode: 'verify-full';
  username: string;
}

/** Parses an injected database secret without logging its credentials. */
export function databaseConnectionString(
  rawSecret: string | undefined,
  variableName = 'DATABASE_SECRET',
): string {
  if (rawSecret === undefined) {
    throw new Error(`${variableName} is required.`);
  }

  const parsed: unknown = JSON.parse(rawSecret);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Partial<DatabaseSecret>).database !== 'string' ||
    typeof (parsed as Partial<DatabaseSecret>).host !== 'string' ||
    typeof (parsed as Partial<DatabaseSecret>).password !== 'string' ||
    typeof (parsed as Partial<DatabaseSecret>).port !== 'number' ||
    typeof (parsed as Partial<DatabaseSecret>).username !== 'string' ||
    (parsed as Partial<DatabaseSecret>).sslmode !== 'verify-full'
  ) {
    throw new Error(`${variableName} has an invalid database credential shape.`);
  }

  const secret = parsed as DatabaseSecret;
  return new URL(
    `postgresql://${encodeURIComponent(secret.username)}:${encodeURIComponent(secret.password)}@${secret.host}:${secret.port}/${secret.database}`,
  ).toString();
}
