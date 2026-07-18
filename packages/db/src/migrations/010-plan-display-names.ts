import { sql, type Kysely } from 'kysely';

/**
 * TRA-44 keeps stable plan codes and all references to them intact while replacing
 * only the customer-facing labels. Existing subscriptions retain their plan_id.
 */
async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE app.billing_plans
    SET
      name = CASE code
        WHEN 'starter' THEN 'Basic'
        WHEN 'practice' THEN 'Pro'
        WHEN 'established' THEN 'Premium'
        ELSE name
      END,
      updated_at = now()
    WHERE code IN ('starter', 'practice', 'established')
      AND name IS DISTINCT FROM CASE code
        WHEN 'starter' THEN 'Basic'
        WHEN 'practice' THEN 'Pro'
        WHEN 'established' THEN 'Premium'
      END;
  `.execute(database);
}

async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE app.billing_plans
    SET
      name = CASE code
        WHEN 'starter' THEN 'Starter'
        WHEN 'practice' THEN 'Practice'
        WHEN 'established' THEN 'Established'
        ELSE name
      END,
      updated_at = now()
    WHERE code IN ('starter', 'practice', 'established')
      AND name IS DISTINCT FROM CASE code
        WHEN 'starter' THEN 'Starter'
        WHEN 'practice' THEN 'Practice'
        WHEN 'established' THEN 'Established'
      END;
  `.execute(database);
}

export const planDisplayNamesMigration = { down, up };
