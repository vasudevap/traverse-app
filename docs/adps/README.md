# Autonomous Development Plans

This directory contains implementation-only Autonomous Development Plans (ADPs) for
the Traverse application. It is safe to share with application contributors: it
contains work-order identifiers, engineering outcomes, dependency waves, and
verification requirements only.

Do not add founder-private strategy, financials, legal deliberation, governance
rationale, or links or attachments from the private documentation workspace here.
Use the assigned Linear issue as the authoritative task record and keep any unclear
decision in the private founder workspace until explicitly cleared for sharing.

## Execution contract

Each ADP runs in its own short-lived worktree and branch. An agent may work without
interactive direction only while the stated scope, dependency state, and acceptance
criteria remain true. Stop and open a bounded follow-up issue when an ADP would:

- change a ratified product or security decision;
- need an undisclosed external credential, account, or approval;
- touch another ADP's exclusive path; or
- expose founder-private material in code, Linear, logs, or documentation.

Every completed ADP must run `pnpm verify`, run its focused tests, update its Linear
evidence, and leave a reviewable branch or pull request. NonProd deployment and
synthetic-data validation are required when the ADP changes a deployable surface.

## Dependency and concurrency map

| ADP                                      | Work orders                         | Entry condition                       | Automatic concurrency                                               |
| ---------------------------------------- | ----------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| 01 Foundation evidence                   | TRA-51                              | None                                  | May run with 02 and 03                                              |
| 02 Stage 2 closure                       | TRA-44 -> TRA-43 -> TRA-35          | None                                  | May run with 01; isolate from video-specific changes                |
| 03 Stage 3 evidence spike                | TRA-47, then generated children     | None                                  | May run with 01; run beside 02 only with non-overlapping paths      |
| 04 Stage 4 payments                      | TRA-61-67, TRA-27, TRA-45 -> TRA-53 | TRA-43 complete                       | Serial foundation, then controlled module lanes                     |
| 05 Stage 5 experience and communications | TRA-58, TRA-69-73 -> TRA-68         | TRA-46 and TRA-53 complete            | After Stage 4, use declared submodule lanes only                    |
| 06 Stage 6 operations apps               | TRA-75-80 -> TRA-74                 | TRA-55 and TRA-68 complete            | Billing Admin and Admin views may split after shared contracts land |
| 07 Stage 7 release hardening             | TRA-82-88, TRA-50, TRA-52 -> TRA-81 | Stages 3-6 and beta evidence complete | Mostly serial release train                                         |

The Stage 3 delivery child set is intentionally unknown until TRA-47 supplies
measured evidence. Do not manufacture its ADPs in advance.

## Parallelism rules

Parallel means no shared migration, API contract, package, deployment workflow, or
customer-facing route is being edited at the same time. Separate worktrees alone do
not make intersecting changes safe to merge unattended.

The safe opening wave is ADP-01, ADP-02, and ADP-03 with the restriction above.
Later ADPs become eligible only when their entry condition is evidenced in Linear.
Within a later-stage ADP, the plan declares which work orders are serial and which
may be split after their shared contract has landed.
