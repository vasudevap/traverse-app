import { sql, type TraverseDatabaseClient } from '@traverse/db';

export const NONPROD_TEST_DATA_RESET_CONFIRMATION = 'RESET_NONPROD_TEST_DATA';

export interface NonprodTestDataResetCounts {
  billingPlans: number;
  clientInvites: number;
  clients: number;
  coaches: number;
  legalDocuments: number;
  queuedJobs: number;
  stripeWebhookEvents: number;
  tenants: number;
  users: number;
}

function requireResetAuthorization(
  environment: string | undefined,
  confirmation: string | undefined,
): void {
  if (environment !== 'nonprod') {
    throw new Error('NonProd test-data reset can run only when DEPLOYMENT_ENVIRONMENT is nonprod.');
  }

  if (confirmation !== NONPROD_TEST_DATA_RESET_CONFIRMATION) {
    throw new Error(
      'NonProd test-data reset requires the exact RESET_NONPROD_TEST_DATA confirmation.',
    );
  }
}

function assertResetPostconditions(counts: NonprodTestDataResetCounts): void {
  const residualData = Object.entries({
    clientInvites: counts.clientInvites,
    clients: counts.clients,
    coaches: counts.coaches,
    queuedJobs: counts.queuedJobs,
    stripeWebhookEvents: counts.stripeWebhookEvents,
    tenants: counts.tenants,
    users: counts.users,
  }).filter(([, count]) => count !== 0);

  if (residualData.length > 0) {
    throw new Error(
      `NonProd reset verification failed: ${JSON.stringify(Object.fromEntries(residualData))}`,
    );
  }

  if (counts.billingPlans === 0 || counts.legalDocuments === 0) {
    throw new Error(
      'NonProd reset verification failed: static billing or legal seed data is missing.',
    );
  }
}

/**
 * Removes every NonProd test account and its dependent data without changing schema,
 * migration history, queue definitions, billing plans, or legal-document seeds.
 *
 * This function is intentionally callable only from the privileged migration task.
 * The workflow that invokes it must also pause all staging services before it runs.
 */
export async function resetNonprodTestData(
  database: TraverseDatabaseClient,
  environment = process.env.DEPLOYMENT_ENVIRONMENT,
  confirmation = process.env.RESET_NONPROD_TEST_DATA,
): Promise<NonprodTestDataResetCounts> {
  requireResetAuthorization(environment, confirmation);

  await sql`
    TRUNCATE TABLE
      app.users,
      app.tenants,
      app.stripe_webhook_events,
      pgboss.job
    RESTART IDENTITY CASCADE
  `.execute(database);

  const result = await sql<NonprodTestDataResetCounts>`
    SELECT
      (SELECT count(*)::integer FROM app.users) AS "users",
      (SELECT count(*)::integer FROM app.tenants) AS "tenants",
      (SELECT count(*)::integer FROM app.coaches) AS "coaches",
      (SELECT count(*)::integer FROM app.clients) AS "clients",
      (SELECT count(*)::integer FROM app.client_invites) AS "clientInvites",
      (SELECT count(*)::integer FROM app.stripe_webhook_events) AS "stripeWebhookEvents",
      (SELECT count(*)::integer FROM pgboss.job) AS "queuedJobs",
      (SELECT count(*)::integer FROM app.billing_plans) AS "billingPlans",
      (SELECT count(*)::integer FROM app.legal_documents) AS "legalDocuments"
  `.execute(database);
  const counts = result.rows[0];

  if (counts === undefined) {
    throw new Error('NonProd reset verification returned no result.');
  }

  assertResetPostconditions(counts);
  return counts;
}
