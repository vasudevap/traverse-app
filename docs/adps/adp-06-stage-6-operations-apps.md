# ADP-06: Stage 6 operations apps

## Work-order batch

TRA-75-80 -> TRA-74

## Entry condition

TRA-55 and TRA-68 are complete. The required commercial records from Stage 4 are
available to the operations surfaces.

## Wave 1: shared boundaries

- TRA-75 establishes the Admin authentication, authorization, no-content boundary,
  and application foundation.
- TRA-76 establishes Billing Admin identity, invitations, client mapping, and
  cross-practice tenant isolation.

These are serial if they require the same role, policy, migration, or API-contract
changes. Once their shared contracts are merged, the UI lanes may split.

## Wave 2: operations surfaces

- TRA-78: Admin operational, finance, audit, storage, and health views.
- TRA-79: Admin support and reconciliation tools after the relevant operations views.
- TRA-77: Billing Admin mapped-client payment, receipt, history, and unlink flows.

TRA-77 may run beside the Admin lane only when its Billing Admin routes and contracts
remain isolated from Admin-owned paths.

## Wave 3: boundary acceptance

TRA-80 verifies role separation, tenant isolation, and the complete Admin and Billing
Admin journeys. TRA-74 closes only after the evidence is accepted.

## Verification

Run role-boundary and tenant-isolation tests for every lane, then `pnpm verify` and
NonProd smoke tests using synthetic accounts.
