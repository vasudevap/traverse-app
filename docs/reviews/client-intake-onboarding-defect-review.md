# Client intake onboarding defect - code review

Review date: 2026-07-25
Scope: static review, local PostgreSQL reproduction, the narrow first-phase fix,
and an authorized read-only NonProd data audit.
Repository baseline reviewed: `main` at `9d20b0a`, after
`5bd90ff fix: repair client onboarding intake setup`.

## Evidence status

| Evidence                                                 | Status                             |
| -------------------------------------------------------- | ---------------------------------- |
| Static schema and store diagnosis                        | Confirmed                          |
| Local PostgreSQL 18.4 reproduction as `traverse_runtime` | Confirmed                          |
| Real PostgreSQL G4 regression suite                      | Confirmed, 38 passed and 0 skipped |
| Read-only staging data confirmation                      | Confirmed, policy-only block       |

The current diagnosis is **confirmed statically, through PostgreSQL reproduction,
and through an authorized read-only staging query**. The staging audit ran as
`traverse_runtime` with row security enabled, read-only transactions, and complete
tenant, actor, Coach, and Client context for the confirming query.

## Reported symptom

A Client signs the coaching agreement and is then blocked. Reported staging state:

| Field                   | Value                                              |
| ----------------------- | -------------------------------------------------- |
| `contract.clientSigned` | `true`                                             |
| `gates.intakeRequired`  | `true`                                             |
| `state`                 | `intake_pending`                                   |
| `intake`                | `null`                                             |
| Coach UI                | "Waiting for the client to complete their intake." |
| Client UI               | No intake to complete                              |

The initial report attributed this to a relationship record with no intake form
attached. The read-only audit found that the only staging relationship already has
an active, same-Coach intake form assigned. Its relationship row is Client-visible,
but the production form join returns zero rows. The current staging case is
therefore an authorization defect, not a missing-form data defect. A Coach-side
manual "Repair intake setup" action remains deployed for genuinely malformed rows.

## Conclusion

The immediate, reproducible, and staging-confirmed defect is that
**`app.intake_forms` had no row-level-security policy permitting a Client to read
the form assigned to their coaching relationship**. The snapshot and submission
queries both join through that table under Client RLS context, so the missing
policy hides the assigned form and causes submission lookup to return no row.

Migration `013` fixes only that authorization gap. It was not deployed when the
staging audit ran: staging still had only `intake_forms_coach_all`. The current
staging dataset contains one relationship and one invite, with no required
missing-form row or assignment anomaly. This small dataset does not prove that
future imports or other environments cannot contain malformed rows. The schema can
still represent `intakeRequired: true` with `intake_form_id: NULL`, so no automatic
data remediation is justified.

---

## 1. Root cause

### 1.1 The missing policy

`packages/db/src/migrations/004-stage2-core-domain.ts:641-662` grants coach-owned
tables exactly one policy each:

```
const coachOwnedTables = ['contract_templates','intake_forms','client_invites',
                          'groups','appointment_types','availability_windows'];
CREATE POLICY ${table}_coach_all ON app.${table}
  FOR ALL
  USING (tenant_id = app.current_tenant_id() AND app.can_manage_coach(coach_id))
```

`app.can_manage_coach` (`004-stage2-core-domain.ts:35-52`) returns true only for
`role = 'admin'` or `role = 'coach'`. For `role = 'client'` it returns false.

Both `ENABLE` and `FORCE ROW LEVEL SECURITY` are set
(`004-stage2-core-domain.ts:653-654`), and the API connects as the non-owner,
non-`BYPASSRLS` role `traverse_runtime`. A Client-context `SELECT` on
`app.intake_forms` therefore returns zero rows, silently, with no error.

Migration `008-coaching-loop.ts:52, 68, 107` later retro-fitted `*_client_select`
policies onto three of those six tables: `appointment_types`,
`availability_windows`, and `booking_holds`. **`intake_forms` and
`contract_templates` were never given one.** That omission is the defect.

### 1.2 How it produces the exact reported payload

`apps/api/src/client-onboarding-store.ts:399-409`, inside `onboardingSnapshot()`:

```ts
const intake = await database
  .selectFrom('intake_forms as form')
  .innerJoin('coaching_relationships as relationship', 'relationship.intake_form_id', 'form.id')
  ...
  .executeTakeFirst();
```

An `innerJoin` against an RLS-empty table yields `undefined`, which becomes
`intake: null` at `client-onboarding-store.ts:424-432`. This runs under
`clientOnboardingContext` (role `client`) for `getOnboarding`,
`getPendingOnboarding`, `signContract`, and `submitIntake`
(`client-onboarding-store.ts:1121-1144`, `:1197`, `:1281`).

Meanwhile `gates` is read from `relationship.gate_config`
(`client-onboarding-store.ts:423`), and Clients can read `coaching_relationships`
through `coaching_relationships_client_scope_resolution`
(`007-client-onboarding.ts:47-53`), so `intakeRequired: true` is reported correctly.
The contract renders because `contract_instances` does have a `_client_select`
policy (`004-stage2-core-domain.ts:681-691`).

That combination is precisely the reported payload.

### 1.3 The Client also cannot submit, independently of the UI

`apps/api/src/client-onboarding-store.ts:1286-1300`:

```ts
.selectFrom('coaching_relationships as relationship')
.innerJoin('intake_forms as form', 'form.id', 'relationship.intake_form_id')
```

The same RLS wall yields `undefined`, the store returns `undefined`, and the service
raises `NotFoundException` (`client-onboarding.service.ts:471`). A hand-crafted
`POST /client/onboarding/:relationshipId/intake` returns 404. The Client is blocked
at the database layer, not merely in the interface.

### 1.4 Corroboration from the Coach surface

`apps/coach/src/App.tsx:852-861`:

```ts
case 'intake_pending':
  return relationship.intakeFormId === null
    ? { action: { label: 'Repair intake setup' }, ... }
    : { action: null, message: 'Waiting for the client to complete their intake.' };
```

The Coach UI shows "Waiting for the client to complete their intake" **only when
`intakeFormId !== null`**. The read-only staging audit confirmed that the only
relationship has a populated `coaching_relationships.intake_form_id`, and that the
assigned form is active and owned by the same Coach. The Coach reads the column
directly in Coach context (`apps/api/src/coaching-loop-store.ts:465, 520`), while
the Client snapshot reads through `intake_forms`.

A separate title issue remains: `contract_templates` is intentionally not made
Client-readable in this phase. The `leftJoin` at
`client-onboarding-store.ts:387` therefore falls back to
`'Coaching agreement'` (`client-onboarding-store.ts:421`). Contract titles should
eventually be copied onto `contract_instances` as an immutable instance snapshot,
alongside the already snapshotted body and template version. Broadening Client
access to the mutable template library is not the appropriate fix.

### 1.5 Local and staging confirming query

The local PostgreSQL reproduction used a relationship with a non-null assigned
form. Under complete Client context, the relationship query returned one row and
the production form join returned zero before migration `013`:

```sql
relationship_rows=1
assigned_form_rows=0
```

The staging confirmation was explicitly authorized and ran as `traverse_runtime`,
not as the table owner. The audit supplied verified values for the only staging
relationship and ran the equivalent of this entire transaction:

```sql
\set tenant_id        '00000000-0000-0000-0000-000000000000'
\set actor_user_id    '00000000-0000-0000-0000-000000000000'
\set coach_id         '00000000-0000-0000-0000-000000000000'
\set client_id        '00000000-0000-0000-0000-000000000000'
\set relationship_id  '00000000-0000-0000-0000-000000000000'

BEGIN TRANSACTION READ ONLY;
SET LOCAL ROLE traverse_runtime;

SELECT
  set_config('app.tenant_id', :'tenant_id', true),
  set_config('app.actor_id', :'actor_user_id', true),
  set_config('app.role', 'client', true),
  set_config('app.coach_id', :'coach_id', true),
  set_config('app.client_id', :'client_id', true),
  set_config('app.practice_role', '', true);

SELECT count(*)::integer AS relationship_rows
FROM app.coaching_relationships AS relationship
WHERE relationship.id = :'relationship_id'
  AND relationship.client_id = :'client_id';

SELECT count(*)::integer AS assigned_form_rows
FROM app.intake_forms AS form
INNER JOIN app.coaching_relationships AS relationship
  ON relationship.intake_form_id = form.id
WHERE relationship.id = :'relationship_id'
  AND relationship.client_id = :'client_id';

ROLLBACK;
```

The 2026-07-25 NonProd result was:

```text
current_user=traverse_runtime
session_user=traverse_runtime
row_security=on
transaction_read_only=on
rolsuper=false
rolbypassrls=false
relationship_rows=1
assigned_form_rows=0
```

The relationship was non-archived, `intake_pending`, and `onboarding`, with a
non-null active form owned by the same Coach. `pg_policies` showed only
`intake_forms_coach_all`; `intake_forms_client_select` was not deployed. This is a
policy-only staging reproduction. After migration `013`, the second query should
return exactly the assigned form. A null `intake_form_id` would instead identify a
separate malformed-data case.

---

## 2. Secondary defects

These are confirmed static weaknesses that can coexist with the RLS defect. The
read-only audit found none of the listed malformed assignment shapes in the
current one-relationship, one-invite staging dataset.

**S1 - No database invariant. Confirmed.**
`004-stage2-core-domain.ts:199-208` adds `gate_config`, `contract_template_id`, and
`intake_form_id` with composite foreign keys only. Nothing prevents
`gate_config->>'intakeRequired' = 'true'` with `intake_form_id IS NULL`, on either
`coaching_relationships` or `client_invites`
(`004-stage2-core-domain.ts:210-246`). The column default at
`004-stage2-core-domain.ts:200` is `intakeRequired: true`, so omitting `gate_config`
produces the invalid shape by default.

Staging result: zero relationships and zero invites had `intakeRequired: true`
with `intake_form_id IS NULL`.

**S2 - The CSV import writes exactly that shape. Confirmed code path, unproven as a
source of these records.**
`apps/api/src/data-portability-store.ts:262-274` inserts a relationship with no
`gate_config` and no `intake_form_id`, giving the default `intakeRequired: true` with
`intake_form_id: NULL` at `onboarding_state: 'imported'`. `createInvite` overwrites
both when it adopts the imported row
(`client-onboarding-store.ts:760-796`), so it is normally corrected before a Client
sees it. The row is nonetheless invalid at rest, and this is the only writer in the
codebase that produces the invalid pair without validation.

Staging result: no malformed missing-form relationship had import provenance.

**S3 - The state machine never checks form presence. Confirmed.**
`client-onboarding-store.ts:174-186` (`determineOnboardingState`) and the database
trigger `app.guard_client_onboarding_transition`
(`007-client-onboarding.ts:114-117`) both derive `intake_pending` from `gate_config`
alone. Neither consults `intake_form_id`. `intake_pending` is reachable with no form,
by construction, at both the service and the database layer.

**S4 - `createInvite` does not validate the intake form. Confirmed.**
The contract branch validates ownership and `active` and throws
(`client-onboarding-store.ts:798-805`, `executeTakeFirstOrThrow`). The intake form id
is passed straight through at `client-onboarding-store.ts:777`, `:789`, and `:827`
with no equivalent check. The composite foreign key enforces only
`(tenant_id, intake_form_id)`, so a form belonging to a different coach in the same
practice, or one with `active = false`, is accepted. A later-deactivated form leaves
the Coach dashboard reporting a healthy relationship while `getInviteOptions`
(`client-onboarding-store.ts:569-575`, filters `active = true`) no longer offers it.

Staging result: zero dangling assignments, zero cross-Coach assignments, and zero
inactive-form assignments were present on relationships or invites.

**S5 - Service validation is bypassable. Confirmed.**
`apps/api/src/client-onboarding.service.ts:282-284` is the only place enforcing
`intakeRequired` implies `intakeFormId`. It is absent from the store, absent from the
schema, not applied to the import path, and not applied to any pre-existing row. It
has been present since the original TRA-40 implementation
(`git log -S "Select an intake form for this client"` returns only `d2fa48c`).
That static history does not establish the origin of any staging record.

---

## 3. Why the deployed repair action does not fix the policy defect

`repairMissingIntake` (`client-onboarding-store.ts:1146-1190`) sets `intake_form_id`
and returns. Under the RLS defect the Client snapshot is still `intake: null`,
because the Client still cannot read `app.intake_forms`.

It also degrades diagnosis. It flips the Coach UI from "Intake setup needs your
attention" to "Waiting for the client to complete their intake"
(`apps/coach/src/App.tsx:852-861`), removing the only signal a Coach had, while
changing nothing for the Client. And because it filters on
`.where('intake_form_id', 'is', null)` (`client-onboarding-store.ts:1157`), a Coach
looking at a genuinely stuck Client whose row is already populated receives a 404:
"This client onboarding setup can no longer be repaired."

The endpoint and current UI must remain for now. They may still be needed for
genuinely malformed rows in future imports or other environments. The current
staging audit found no such row. It also confirmed that the only relationship
already has a non-null form, so this repair endpoint's null-only update cannot fix
the observed staging block.

---

## 4. First-phase implementation

### Immediate fix - assigned intake form read policy

Migration `013` adds one policy scoped to assigned forms only. It must not widen to
all forms in the tenant: `intake_forms` is coach-owned and tenant-scoped, so a naive
`tenant_id = current_tenant_id() AND role = 'client'` policy would expose every
coach's form library to every Client in the practice.

```sql
CREATE POLICY intake_forms_client_select ON app.intake_forms
  FOR SELECT USING (
    tenant_id = app.current_tenant_id()
    AND app.current_actor_role() = 'client'
    AND EXISTS (
      SELECT 1 FROM app.coaching_relationships AS relationship
      WHERE relationship.tenant_id = intake_forms.tenant_id
        AND relationship.intake_form_id = intake_forms.id
        AND relationship.client_id = app.current_client_id()
        AND relationship.archived_at IS NULL
    )
  );
```

The policy deliberately does not filter on `intake_forms.active`. A form already
assigned to a live relationship remains readable if the Coach later deactivates the
template, allowing an in-progress onboarding flow to finish. An archived
relationship does not grant access.

Existing Coach and Admin access remains in place because PostgreSQL policies are
permissive and the original `intake_forms_coach_all` policy is unchanged. The
`down()` migration removes only `intake_forms_client_select`.

No supporting index was added. A local PostgreSQL 18.4
`EXPLAIN (ANALYZE, BUFFERS)` with 20,000 active relationships used the existing
`coaching_relationships_active_unique_idx` for
`client_id = app.current_client_id()`. The policy-filtered form read completed in
0.115 ms. That evidence does not justify another index.

### Deferred - invariants and ownership constraints

CHECK constraints, composite foreign keys, ownership rules, and state-machine
guards are separate design work. They are not part of migration `013`. They require
a completed data audit, explicit treatment of imported, revoked, declined, and
legacy states, and a rollout plan that will not reject valid historical rows.

The earlier lock claim was incorrect. PostgreSQL still takes an
`ACCESS EXCLUSIVE` lock to add a CHECK constraint with `NOT VALID`. A later
`VALIDATE CONSTRAINT` uses `SHARE UPDATE EXCLUSIVE`. `NOT VALID` avoids the initial
table scan, but it does not reduce the lock mode used by `ADD CONSTRAINT`.

### Deferred - data remediation and audit events

Migration `013` performs no data update and writes no `event_log` rows. Assigning a
Coach's arbitrary oldest active form could attach the wrong questionnaire and
change the evidence a Client is asked to provide. Migration-authored audit events
would also misrepresent who made the business decision.

Any remediation must follow a read-only data audit in the target environment and
an owner-approved mapping rule. Genuinely malformed rows may require Coach
confirmation, an explicit administrative repair, or a documented exception. The
existing repair endpoint and UI remain available until those handling rules are
designed.

### Deferred - transactional API behaviour

These are follow-up hardening candidates, not part of the authorization fix:

- Move the `intakeRequired` implies `intakeFormId` check from
  `client-onboarding.service.ts:282` into the store, inside the `withTenantContext`
  transaction, so a future caller cannot bypass it.
- Validate the intake form the way the contract template is validated
  (`client-onboarding-store.ts:798-805`): `where coach_id = actor.coachId and
active = true`, with `executeTakeFirstOrThrow`. Closes S4.
- Make `data-portability-store.ts:262-274` write an explicit `gate_config` with
  `intakeRequired: false` for imported rows, or attach the coach's default form. Do
  not rely on the column default. Closes S2.
- Make `advanceOnboarding` (`client-onboarding-store.ts:438-499`) refuse to write
  `intake_pending` when `intake_form_id IS NULL`, failing loudly rather than parking
  the Client.

### Deferred - interface behaviour

- Client (`apps/client/src/App.tsx:577-588`): the "your coach is updating the next
  step" branch attributes an authorization bug to Coach setup. Once migration `013`
  lands it becomes genuinely unreachable. Keep it as a hard-error state with a
  support reference, not a reassuring wait screen.
- Coach (`apps/coach/src/App.tsx:852-861`): key the warning on server-computed
  onboarding health rather than on `intakeFormId === null`. A Coach must be able to
  see that a Client is blocked even when the row looks well-formed.
- Retain `POST /coach/relationships/:relationshipId/intake-form`
  (`apps/api/src/client-onboarding.controller.ts:107-115`) and the current repair UI
  until malformed-row handling is designed across every target environment.

Form snapshot and versioning semantics are also separate design work. This phase
preserves the current form assignment and response model.

### PostgreSQL regression coverage

The prior in-memory onboarding tests could not exercise RLS. The G4 suite now:

1. Proves migration `013` up, full down, and reapplication.
2. Runs under `traverse_runtime` with explicit Client context.
3. Allows exactly the assigned form through a non-archived relationship.
4. Denies an unassigned same-tenant form, another Client's same-tenant form, a
   cross-tenant form, and a form reachable only through an archived relationship.
5. Keeps an inactive but already-assigned form readable.
6. Fails closed when tenant or Client context is missing.
7. Confirms existing owner, regular Coach, and Admin visibility is unchanged.
8. Exercises the real `DatabaseClientOnboardingStore`: create invite, accept,
   sign, observe `intake_pending` with non-null intake, submit, and observe
   `active`.

Focused evidence:

```text
G4_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/traverse_g4 \
  pnpm --filter @traverse/db test

tests 38
pass 38
fail 0
skipped 0
```

---

## 5. Acceptance-test matrix

| #   | Precondition                                 | Action                 | Expected                                                          |
| --- | -------------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| A1  | Client context, live assigned relationship   | Read `intake_forms`    | Exactly the assigned form                                         |
| A2  | Same tenant, unassigned form                 | Read `intake_forms`    | 0 rows                                                            |
| A3  | Same tenant, form assigned to another Client | Read `intake_forms`    | 0 rows                                                            |
| A4  | Form belongs to another tenant               | Read `intake_forms`    | 0 rows                                                            |
| A5  | Assigned form later becomes inactive         | Read `intake_forms`    | Assigned form remains readable                                    |
| A6  | Relationship is archived                     | Read its assigned form | 0 rows                                                            |
| A7  | Tenant or Client context is missing          | Read `intake_forms`    | 0 rows                                                            |
| A8  | Owner, regular Coach, and Admin contexts     | Read `intake_forms`    | Existing privileged scope unchanged                               |
| A9  | Invite requires contract and intake          | Accept, sign, submit   | `contract_pending` to `intake_pending` with intake, then `active` |
| A10 | Migration chain                              | Up, down, reapply      | All operations succeed and policy is present                      |

---

## 6. Migration and deployment risks

**A too-broad policy leaks data across the practice.** `intake_forms` is coach-owned
and tenant-scoped, not relationship-scoped. Scope the new policy strictly through
`coaching_relationships.intake_form_id = intake_forms.id AND client_id =
app.current_client_id()`. A1 through A4 are the direct boundary tests.

**Archived relationships must fail closed.** The policy explicitly requires
`relationship.archived_at IS NULL`. A6 proves that an old assignment cannot retain
form access.

**Inactive assigned forms must remain usable.** Filtering on `form.active` would
strand an in-progress Client when a Coach retires a template. A5 protects the
chosen finish-in-progress behavior.

**Missing context must not widen access.** The outer tenant comparison, Client role
check, and relationship ownership lookup all evaluate closed when their required
settings are absent. A7 covers missing tenant and Client identifiers.

**Rollback must remove only the new policy.** Migration `013` drops
`intake_forms_client_select` and leaves the pre-existing Coach policy untouched.
The migration chain test runs initial up, full down, and reapplication.

**Deployment ordering.** Migration `013` is backward-compatible with the current
API because it only adds the missing read path. It does not mutate data, add a
constraint, modify a trigger, or change the repair endpoint.

At audit time, migration `013` was not deployed to NonProd. The policy-only staging
reproduction is pre-migration evidence, not post-deployment verification.

**Verification discipline.** Per `AGENTS.md`, run `pnpm verify`,
`pnpm audit:dependencies`, `bash .github/scripts/test-ecs-deployment-revision.sh`,
and the Terraform checks locally before pushing. Set `G4_DATABASE_URL` so the
PostgreSQL gate actually executes: the new RLS tests are worthless while G4 stays
skipped.

---

## 7. Second-phase read-only staging audit

The authorized audit completed on 2026-07-25 against AWS account `124074140404`
using the exact deployed NonProd API task definition and its injected
`traverse_runtime` database credential. It used `BEGIN TRANSACTION READ ONLY`,
`SET LOCAL ROLE traverse_runtime`, and all six `app.*` settings for every
tenant-scoped and Client reproduction query. It selected no names, email
addresses, form contents, or intake answers.

| Audit item                                         | NonProd result |
| -------------------------------------------------- | -------------- |
| Tenant contexts audited                            | 1              |
| Ownerless tenant contexts                          | 0              |
| Relationships                                      | 1              |
| Intake-required relationships                      | 1              |
| Required relationships missing a form              | 0              |
| Live `intake_pending` relationships missing a form | 0              |
| Assigned relationship forms                        | 1              |
| Dangling relationship assignments                  | 0              |
| Cross-Coach relationship assignments               | 0              |
| Inactive relationship assignments                  | 0              |
| Invites                                            | 1              |
| Intake-required invites                            | 1              |
| Required invites missing a form                    | 0              |
| Cross-Coach or inactive invite assignments         | 0              |
| Complete-context Client policy-only reproductions  | 1              |
| Complete-context stored-data missing-form cases    | 0              |
| Client policies on `contract_templates`            | 0              |

No remediation category can be designed from a malformed staging sample because
none exists. This small dataset had no additional tenants, Clients, archived
relationships, or malformed categories to sample. The next data-safety work is
therefore:

1. Re-run this read-only inventory immediately before any future constraint or
   remediation rollout, and run it separately in each authorized environment.
2. If a malformed category appears, sample it under complete `traverse_runtime`
   context and classify it as Coach-confirmed repair, administrative exception, or
   historical record requiring no mutation. Do not infer an arbitrary form.
3. Design the constraint rollout separately, including exact allowed legacy states,
   `ACCESS EXCLUSIVE` lock planning for `ADD CHECK ... NOT VALID`, later validation,
   and rollback behavior.
4. Design immutable contract title snapshots on `contract_instances`. Do not add a
   Client policy to `contract_templates`.
5. Decide form snapshot and versioning semantics before changing how assigned forms
   or responses preserve historical content.
6. Define application-authored audit events for approved repair actions. Do not
   insert migration-authored `event_log` records.

Retain the repair endpoint and UI until these rules are designed. Do not choose an
arbitrary oldest form, add ownership constraints, or perform a data backfill in
this phase.
