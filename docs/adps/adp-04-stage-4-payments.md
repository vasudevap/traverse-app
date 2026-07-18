# ADP-04: Stage 4 payments

## Work-order batch

TRA-61-67, TRA-27, TRA-45 -> TRA-53

## Entry condition

TRA-43 is complete with its NonProd acceptance evidence.

## Wave 1: shared payment foundation

TRA-61 is exclusive. It owns the remaining commercial schema, provider isolation,
webhook ledgers, queue integration, tenant boundaries, and append-only records.
No other Stage 4 implementation ADP may start until this shared contract is merged.

## Wave 2: bounded module lanes

After Wave 1 lands, the following may be planned as separate worktrees only when they
do not need the same migration, route, provider adapter, or coach-app surface:

- TRA-62: connected-account onboarding and capability lifecycle.
- TRA-63: offerings, invoices, payer routing, immutable records, and offline payment
  recording.
- TRA-64: platform subscription catalog, lifecycle, and customer portal.

If any lane requires a shared schema or API change, merge that contract first and run
the dependent lanes serially. Do not rely on later conflict resolution.

## Wave 3: dependent payment behavior

- TRA-65 starts after TRA-62 and TRA-63.
- TRA-66 starts after TRA-65.
- TRA-45 and TRA-27 start after TRA-64 and any shared contract they require.

## Wave 4: integrated acceptance

TRA-67 runs after every delivery order. It verifies end-to-end payment behavior,
provider-event handling, reconciliation, and failure recovery in NonProd. TRA-53
closes only with that evidence.

## Verification

Each lane runs focused unit, integration, tenant-boundary, and provider-contract
tests. The final wave also runs `pnpm verify`, NonProd deployment, synthetic-data
smoke, and rollback checks.
