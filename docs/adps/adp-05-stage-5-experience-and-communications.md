# ADP-05: Stage 5 experience and communications

## Work-order batch

TRA-58, TRA-69-73 -> TRA-68

## Entry condition

The required Stage 3 and Stage 4 delivery evidence is complete. TRA-58 must be
complete before the full consent and communications lifecycle can close.

## Wave 1: independent feature foundations

- TRA-71: practice branding profiles, assets, theming, stored presentation snapshots,
  and plan gates.
- TRA-70: legal-version lifecycle, re-acceptance, consent records, and signed
  artifacts after TRA-58.
- TRA-69: notification channels, preferences, suppression, push delivery, and
  reliability after its Stage 3 and Stage 4 prerequisites.

These may be split only after their shared domain contracts and migrations are landed.
The agent must serialize any overlapping API, UI, or schema contract.

## Wave 2: catalog completion

TRA-72 completes the notification trigger and template catalog after TRA-69, TRA-70,
and TRA-71.

## Wave 3: integrated acceptance

TRA-73 verifies branding, consent, communications, accessibility, provider delivery,
and the relevant evidence gates. TRA-68 closes after that evidence is attached.

## Verification

Run focused notification, preference, consent, accessibility, and branding tests by
lane, then `pnpm verify` and a NonProd synthetic-data journey before closure.
