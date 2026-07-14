/** Shared database and RLS foundations. Business schema migrations remain in TRA-25. */
export const DB_PACKAGE = '@traverse/db';

export {
  assertRlsContract,
  auditRlsContract,
  type RlsAuditOptions,
  type SqlClient,
} from './rls-audit.js';
