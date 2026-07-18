import type { ColumnType, Generated } from 'kysely';

export type ActorRole = 'admin' | 'billingAdmin' | 'client' | 'coach';
export type PracticeRole = 'coach' | 'owner';
export type AuthTokenPurpose = 'email_verify' | 'magic_link' | 'password_reset';
export type JsonValue =
  boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

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
  metadata: Generated<JsonValue>;
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
  legal_name: string | null;
  business_email: string | null;
  phone: string | null;
  timezone: Generated<string>;
  coach_type: string | null;
  business_address: string | null;
  website_url: string | null;
  setup_state: Generated<string>;
  onboarding_defaults: Generated<JsonValue>;
  message_templates: Generated<JsonValue>;
  policy_defaults: Generated<JsonValue>;
  setup_progress: Generated<JsonValue>;
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
  specialties: Generated<string[]>;
  profile_photo_ref: string | null;
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
  gate_config: Generated<JsonValue>;
  contract_template_id: string | null;
  intake_form_id: string | null;
  notes_enc: Buffer | null;
  notes_key_version: number | null;
  archived_at: NullableTimestamp;
  tags: Generated<string[]>;
  source_import_id: string | null;
}

export interface BillingPlanTable extends AuditColumns {
  id: Generated<string>;
  code: string;
  name: string;
  monthly_prices: JsonValue;
  annual_prices: JsonValue;
  client_cap: number | null;
  storage_gb: number;
  retention_max_days: number;
  active: Generated<boolean>;
}

export interface CoachBillingCustomerTable extends AuditColumns {
  tenant_id: string;
  stripe_customer_id: string;
}

export interface CoachSubscriptionTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  plan_id: string;
  status: Generated<string>;
  billing_interval: Generated<string>;
  currency: Generated<string>;
  trial_started_at: Generated<Timestamp>;
  trial_ends_at: Timestamp;
  promotion_code: string | null;
  current_period_end: NullableTimestamp;
  cancel_at_period_end: Generated<boolean>;
  stripe_subscription_id: string | null;
}

export interface LegalDocumentTable extends AuditColumns {
  id: Generated<string>;
  document_type: string;
  version: string;
  status: Generated<string>;
  effective_at: NullableTimestamp;
  content_ref: string;
}

export interface LegalAcceptanceTable {
  id: Generated<string>;
  user_id: string;
  legal_document_id: string;
  document_type: string;
  version: string;
  accepted_at: Generated<Timestamp>;
  ip: string | null;
  user_agent: string | null;
  created_at: Generated<Timestamp>;
}

export interface ContractTemplateTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  coach_id: string;
  name: string;
  version: Generated<number>;
  body: string;
  active: Generated<boolean>;
}

export interface IntakeFormTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  coach_id: string;
  name: string;
  version: Generated<number>;
  form_schema: JsonValue;
  active: Generated<boolean>;
}

export interface ClientInviteTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  coach_id: string;
  client_name: string;
  email: string;
  phone: string | null;
  token_hash: Buffer;
  gate_config: JsonValue;
  contract_template_id: string | null;
  intake_form_id: string | null;
  proposed_slots: Generated<JsonValue>;
  expires_at: Timestamp;
  accepted_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
  declined_at: NullableTimestamp;
  opened_at: NullableTimestamp;
  sent_at: Timestamp;
  last_sent_at: Timestamp;
  send_count: Generated<number>;
  relationship_id: string | null;
}

export interface ContractInstanceTable {
  id: Generated<string>;
  tenant_id: string;
  relationship_id: string;
  template_id: string | null;
  template_version: number;
  signed_snapshot: string;
  created_at: Generated<Timestamp>;
}

export interface ContractSignatureTable {
  id: Generated<string>;
  tenant_id: string;
  contract_instance_id: string;
  signer_user_id: string;
  signer_role: string;
  signer_name: string;
  consent_text: string;
  signed_at: Generated<Timestamp>;
  ip: string | null;
  user_agent: string | null;
  created_at: Generated<Timestamp>;
}

export interface IntakeResponseTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  relationship_id: string;
  intake_form_id: string;
  form_version: number;
  answers_enc: Buffer;
  answers_key_version: number;
  submitted_at: NullableTimestamp;
}

export interface GroupTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  coach_id: string;
  name: string;
  description: string | null;
  archived_at: NullableTimestamp;
}

export interface GroupMembershipTable {
  id: Generated<string>;
  tenant_id: string;
  group_id: string;
  coach_id: string;
  client_id: string;
  joined_at: Generated<Timestamp>;
  created_at: Generated<Timestamp>;
}

export interface AppointmentTypeTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  coach_id: string;
  name: string;
  default_duration_minutes: number;
  price_amount: number | null;
  currency: string | null;
  notes: string | null;
  self_bookable: Generated<boolean>;
  active: Generated<boolean>;
}

export interface AvailabilityWindowTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  coach_id: string;
  window_type: string;
  weekday: number | null;
  local_starts_at: string | null;
  local_ends_at: string | null;
  slot_starts_at: NullableTimestamp;
  slot_ends_at: NullableTimestamp;
  timezone: string;
  active: Generated<boolean>;
}

export interface BookingHoldTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  availability_window_id: string;
  client_id: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  status: Generated<string>;
  expires_at: Timestamp;
}

export interface AppointmentTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  coach_id: string;
  relationship_id: string | null;
  group_id: string | null;
  appointment_type_id: string | null;
  booking_hold_id: string | null;
  title: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  meeting_link: string | null;
  notes: string | null;
  status: Generated<string>;
  timezone: string;
  booked_by_client_id: string | null;
  canceled_at: NullableTimestamp;
}

export interface TaskTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  relationship_id: string;
  title: string;
  description: string | null;
  due_at: NullableTimestamp;
  status: Generated<string>;
  completed_at: NullableTimestamp;
}

export interface EventLogTable {
  id: Generated<string>;
  tenant_id: string;
  actor_id: string;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Generated<JsonValue>;
  occurred_at: Generated<Timestamp>;
  created_at: Generated<Timestamp>;
}

export interface ExportTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  requested_by: string;
  scope: Generated<string>;
  status: Generated<string>;
  artifact_ref: string | null;
  error_code: string | null;
  expires_at: NullableTimestamp;
  manifest: Generated<JsonValue>;
  archive_size_bytes: number | null;
  completed_at: NullableTimestamp;
}

export interface ImportTable extends AuditColumns {
  id: Generated<string>;
  tenant_id: string;
  requested_by: string;
  source_type: Generated<string>;
  source_ref: string;
  status: Generated<string>;
  total_rows: number | null;
  imported_rows: number | null;
  rejected_rows: number | null;
  error_report_ref: string | null;
  source_filename: string | null;
  source_sha256: string | null;
  error_report: Generated<JsonValue>;
  completed_at: NullableTimestamp;
}

export interface StripeWebhookEventTable {
  id: Generated<string>;
  flow: string;
  stripe_event_id: string;
  event_type: string;
  payload: JsonValue;
  processed_at: Generated<Timestamp>;
  created_at: Generated<Timestamp>;
}

export interface Database {
  appointment_types: AppointmentTypeTable;
  appointments: AppointmentTable;
  auth_subjects: AuthSubjectTable;
  auth_tokens: AuthTokenTable;
  availability_windows: AvailabilityWindowTable;
  billing_plans: BillingPlanTable;
  booking_holds: BookingHoldTable;
  clients: ClientTable;
  client_invites: ClientInviteTable;
  coach_billing_customers: CoachBillingCustomerTable;
  coach_subscriptions: CoachSubscriptionTable;
  coaches: CoachTable;
  coaching_relationships: CoachingRelationshipTable;
  contract_instances: ContractInstanceTable;
  contract_signatures: ContractSignatureTable;
  contract_templates: ContractTemplateTable;
  event_log: EventLogTable;
  exports: ExportTable;
  group_memberships: GroupMembershipTable;
  groups: GroupTable;
  imports: ImportTable;
  intake_forms: IntakeFormTable;
  intake_responses: IntakeResponseTable;
  legal_acceptances: LegalAcceptanceTable;
  legal_documents: LegalDocumentTable;
  sessions: SessionTable;
  stripe_webhook_events: StripeWebhookEventTable;
  tasks: TaskTable;
  tenant_keys: TenantKeyTable;
  tenants: TenantTable;
  users: UserTable;
}
