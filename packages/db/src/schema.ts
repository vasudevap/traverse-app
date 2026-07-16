import type { ColumnType, Generated } from 'kysely';

export type ActorRole = 'admin' | 'billingAdmin' | 'client' | 'coach';
export type PracticeRole = 'coach' | 'owner';
export type AuthTokenPurpose = 'email_verify' | 'magic_link' | 'password_reset';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

interface AuditColumns {
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UserTable extends AuditColumns {
  id: Generated<string>;
  email: string;
  password_hash: string | null;
  name: string;
  status: Generated<string>;
}

export interface SessionTable {
  id: Generated<string>;
  user_id: string;
  role: ActorRole;
  token_hash: Buffer;
  expires_at: Timestamp;
  last_seen_at: Timestamp;
  revoked_at: NullableTimestamp;
  ip: string | null;
  user_agent: string | null;
  created_at: Generated<Timestamp>;
}

export interface AuthTokenTable {
  id: Generated<string>;
  user_id: string;
  purpose: AuthTokenPurpose;
  token_hash: Buffer;
  expires_at: Timestamp;
  used_at: NullableTimestamp;
  created_at: Generated<Timestamp>;
}

export interface AuthSubjectTable {
  user_id: string;
  role: ActorRole;
  tenant_id: string | null;
  coach_id: string | null;
  client_id: string | null;
  practice_role: PracticeRole | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface TenantTable extends AuditColumns {
  id: Generated<string>;
  name: string;
  subdomain: string;
  status: Generated<string>;
  custom_domain: string | null;
  custom_domain_verified_at: NullableTimestamp;
}

export interface TenantKeyTable {
  tenant_id: string;
  wrapped_data_key: Buffer;
  kms_key_id: string;
  key_version: number;
  rotated_at: NullableTimestamp;
  created_at: Generated<Timestamp>;
}

export interface CoachTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  role_in_practice: PracticeRole;
  display_name: string | null;
  bio: string | null;
  discipline: string | null;
  status: Generated<string>;
}

export interface ClientTable extends AuditColumns {
  id: Generated<string>;
  user_id: string;
  name: string;
  phone: string | null;
}

export interface CoachingRelationshipTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  coach_id: string;
  client_id: string;
  status: Generated<string>;
  onboarding_state: Generated<string>;
  notes_enc: Buffer | null;
  notes_key_version: number | null;
  archived_at: NullableTimestamp;
}

export interface Database {
  auth_subjects: AuthSubjectTable;
  auth_tokens: AuthTokenTable;
  clients: ClientTable;
  coaches: CoachTable;
  coaching_relationships: CoachingRelationshipTable;
  sessions: SessionTable;
  tenant_keys: TenantKeyTable;
  tenants: TenantTable;
  users: UserTable;
}
