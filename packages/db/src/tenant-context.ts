import { sql, type Transaction } from 'kysely';
import type { ActorRole, Database, PracticeRole } from './schema.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TenantContext {
  tenantId: string;
  actorId: string;
  role: ActorRole;
  coachId?: string;
  clientId?: string;
  practiceRole?: PracticeRole;
}

export type TenantTransaction = Transaction<Database>;

interface TransactionHost {
  transaction(): {
    execute<T>(callback: (transaction: TenantTransaction) => Promise<T>): Promise<T>;
  };
}

function assertUuid(label: string, value: string | undefined): asserts value is string {
  if (value === undefined || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid UUID.`);
  }
}

function assertContext(context: TenantContext): void {
  assertUuid('tenantId', context.tenantId);
  assertUuid('actorId', context.actorId);

  if (context.role === 'coach') {
    assertUuid('coachId', context.coachId);
    if (context.practiceRole !== 'coach' && context.practiceRole !== 'owner') {
      throw new Error('practiceRole is required for coach tenant context.');
    }
    if (context.clientId !== undefined) {
      throw new Error('clientId is not valid for coach tenant context.');
    }
    return;
  }

  if (context.role === 'client') {
    assertUuid('clientId', context.clientId);
    if (context.practiceRole !== undefined) {
      throw new Error('practiceRole is not valid for client tenant context.');
    }
    if (context.coachId !== undefined) {
      assertUuid('coachId', context.coachId);
    }
    return;
  }

  if (
    context.coachId !== undefined ||
    context.clientId !== undefined ||
    context.practiceRole !== undefined
  ) {
    throw new Error(`${context.role} tenant context cannot include coach or client scope.`);
  }
}

export async function withTenantContext<T>(
  database: TransactionHost,
  context: TenantContext,
  action: (transaction: TenantTransaction) => Promise<T>,
): Promise<T> {
  assertContext(context);

  return database.transaction().execute(async (transaction) => {
    await sql`
      SELECT
        set_config('app.tenant_id', ${context.tenantId}, true),
        set_config('app.actor_id', ${context.actorId}, true),
        set_config('app.role', ${context.role}, true),
        set_config('app.coach_id', ${context.coachId ?? ''}, true),
        set_config('app.client_id', ${context.clientId ?? ''}, true),
        set_config('app.practice_role', ${context.practiceRole ?? ''}, true)
    `.execute(transaction);

    return action(transaction);
  });
}
