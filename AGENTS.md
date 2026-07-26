# Traverse App Repository Instructions

## Application source of truth

`traverse-app` is the sole source of truth for executable product behavior and product
staging. The private documentation workspace is the source of truth for specifications,
governance, UX references, and design walkthroughs.

Any request that changes what a user sees or what the application does must be
implemented, tested, committed, reviewed, and deployed from this repository. Editing a
mockup, walkthrough, specification, or status document never constitutes application
implementation.

Design-review pages under `traversecoaching.com/admin` are reference artifacts. They are
never evidence that a product change reached staging.

Use feature branches and pull requests for application changes. Do not push implementation
directly to `main` unless the owner explicitly authorizes an emergency change. Staging is
defined by the exact revision deployed from `main`, not by an agent-specific or local
development branch.

## Delivery status and evidence

Use only these delivery statuses for application work:

1. `Documented`
2. `Implemented locally`
3. `In PR`
4. `Merged`
5. `Deployed to NonProd`
6. `Verified on NonProd`

Never describe an application change as fixed, applied, done, deployed, verified, or
closed until the corresponding evidence exists. `Verified on NonProd` requires:

1. an application commit in this repository;
2. that commit merged to `main`;
3. every relevant NonProd deployment completed successfully;
4. the deployed API and/or SPA revision confirmed against that commit; and
5. the affected behavior retested on the public staging hostname.

Every application pull request must identify the changed surfaces, required API/static
deployments, automated coverage, staging retest steps, and any private documentation that
must be updated after verification.

After NonProd verification, provide the application PR, commit SHA, deployment run IDs,
verification date, affected surfaces, and concise result so the private documentation
workspace can be updated without copying private material into this repository.

## Repository routing

- Product behavior, React UI, API, workers, database, infrastructure, tests, and product
  deployment workflows belong in `traverse-app`.
- Specifications, founder-private decisions, governance rationale, UX references, design
  walkthroughs, and status ledgers belong in the private documentation workspace.
- When a task begins from the documentation workspace but concerns the live or staging
  product, perform the implementation here first. Update documentation only after the
  application delivery state is known.
- A design-only change must be identified explicitly as `Design reference only`.

## GitHub Actions free-tier discipline

GitHub Actions provides merge and release evidence. It is not the primary debugging loop.

For every source-bearing implementation:

1. Run focused local checks while iterating.
2. Before the first push, run the complete local verification suite: `pnpm verify`,
   `pnpm audit:dependencies`, `bash .github/scripts/test-ecs-deployment-revision.sh`,
   `node .github/scripts/test-deployment-revision.mjs`, and the Terraform formatting,
   initialization, validation, and module tests represented in `.github/workflows/ci.yml`.
3. Record the commands and results in the pull request description.
4. Consolidate changes and push once per coherent review update. Do not push merely to
   discover failures in GitHub.
5. Keep work local until the full local suite is green. A draft pull request is not
   permission to spend hosted minutes on unfinished validation.
6. Do not manually rerun successful or superseded workflows.
7. Do not change CI workflows, required checks, branch protection, runner selection,
   deployment workflows, environments, credentials, or OIDC permissions without explicit
   owner authorization.
8. Never weaken or bypass a required check because the Actions allowance is exhausted.
   Wait for the allowance reset or use an owner-approved self-hosted runner.

Until the path-aware `ci-gate` workflow is confirmed on `main`, assume every pushed pull
request update may run the full hosted suite.
