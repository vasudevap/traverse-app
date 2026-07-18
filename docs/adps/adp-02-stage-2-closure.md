# ADP-02: Stage 2 closure

## Work-order batch

TRA-44 -> TRA-43 -> TRA-35

## Objective

Close the existing NonProd coaching-loop release without changing product scope.

## Wave 1: TRA-44

- Add a forward-only migration for the customer-facing Basic, Pro, and Premium plan
  display labels.
- Preserve stable internal identifiers and existing tenant, signup, trial, and
  subscription references.
- Update customer-facing application labels, API display fields, fixtures, generated
  contract text, and Stripe test-mode product labels.
- Verify the existing currency-localization paths and ensure no retired label appears
  on a customer-facing NonProd surface.

## Wave 2: TRA-43

Starts only after TRA-44 evidence is accepted.

- Add or complete end-to-end, RLS attack, accessibility, and provider-contract tests
  for the delivered Stage 2 flow.
- Deploy to NonProd, run synthetic-data smoke and rollback verification, and collect
  the evidence index.
- Resolve defects found by those checks before requesting parent closure.

## Wave 3: TRA-35

Close the Stage 2 parent only after the Wave 2 evidence is attached and all linked
acceptance checks pass.

## Parallelism

This ADP may run with ADP-01. It may run beside ADP-03 only when the video agent
stays inside video-specific paths and does not modify the same shared API contract,
database migration, configuration, or UI package.

## Verification

Run focused tests during each wave and `pnpm verify` before handoff. Preserve the
existing NonProd deployment and rollback evidence in TRA-43.
