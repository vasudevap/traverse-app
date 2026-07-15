# Traverse AWS infrastructure

This directory contains the Terraform-managed AWS infrastructure for Traverse.

## TRA-16 account baseline

The `account-baseline` module creates the environment-specific security baseline:

- one customer-managed KMS key with rotation enabled
- empty Secrets Manager containers under `traverse/<environment>/...`
- separate ECS task roles for the API, generic worker, and video worker
- resource policies scoped to only the secrets and KMS operations each service needs

The database runtime secret and database migration secret are separate containers.
Application task roles can read only the runtime secret. The migration secret is
reserved for the controlled migration runner introduced by TRA-20.

Terraform creates secret containers only. Secret values must be added with Secrets
Manager after the owning integration is provisioned. Do not pass secret values to
Terraform because they would be recorded in state.

## Authentication

Configure AWS IAM Identity Center profiles named `traverse-nonprod` and
`traverse-prod`, then authenticate before planning or applying:

```sh
aws sso login --profile traverse-nonprod
aws sso login --profile traverse-prod
```

## State

Each AWS account has its own versioned, KMS-encrypted S3 state bucket and native S3
lockfile. Production state never resides in or grants access to the NonProd account.
The state buckets are created by the environment roots under `infra/bootstrap/`.

Do not use Terraform's deprecated DynamoDB locking for new environments. The S3
backends set `use_lockfile = true` and retain bucket versions for state recovery.

## Apply

Run each environment independently:

```sh
terraform -chdir=infra/environments/nonprod init
terraform -chdir=infra/environments/nonprod plan -out=nonprod.tfplan
terraform -chdir=infra/environments/nonprod apply nonprod.tfplan

terraform -chdir=infra/environments/prod init
terraform -chdir=infra/environments/prod plan -out=prod.tfplan
terraform -chdir=infra/environments/prod apply prod.tfplan
```

The AWS provider and backend both have allowed-account guards, so an environment
cannot be applied to the other Traverse account accidentally.

## TRA-18 PostgreSQL and role bootstrap

The `database` module creates private RDS PostgreSQL in the isolated data subnets,
with KMS encryption, `rds.force_ssl=1`, automated backups, PostgreSQL log export,
Performance Insights, storage monitoring, and the H13 sizing profile. The
`closed-beta` profile is `db.t4g.medium` Single-AZ and includes a CPU credit alarm.
The `production-baseline` profile is `db.m7g.large` Multi-AZ.

Runtime images include AWS's RDS global CA bundle and set `NODE_EXTRA_CA_CERTS` so
the API and migration runner validate the RDS certificate chain while retaining
`rejectUnauthorized: true`. Do not replace this control with disabled TLS validation.
The core migration also provisions PostgreSQL's trusted `citext` extension
idempotently, so an empty environment does not depend on the temporary bootstrap
host for that schema prerequisite.

RDS manages the master password in Secrets Manager. Neither Terraform output nor
application roles can read its value. Initialize the DDL and runtime roles by
temporarily enabling the private bootstrap host after the database is available:

```sh
terraform -chdir=infra/environments/nonprod plan \
  -var=database_bootstrap_host_enabled=true \
  -out=nonprod-bootstrap.tfplan
terraform -chdir=infra/environments/nonprod apply nonprod-bootstrap.tfplan
```

Wait until the temporary EC2 instance has the tag
`DatabaseBootstrap=Succeeded`, then immediately return to the default configuration:

```sh
terraform -chdir=infra/environments/nonprod plan -out=nonprod-cleanup.tfplan
terraform -chdir=infra/environments/nonprod apply nonprod-cleanup.tfplan
```

Repeat the same controlled sequence for production using the `prod` environment.
The host runs in a private app subnet, has no public address or SSH key, retrieves
the RDS master value only at runtime, writes generated role credentials directly to
their secret containers, and shuts itself down. A normal plan must remove the host,
its role, security group, and temporary RDS ingress.

The canonical role foundation is `packages/db/sql/roles-and-rls.sql`. It creates a
DDL owner and a non-owner runtime role with `NOBYPASSRLS`, removes unsafe schema
creation, installs fail-closed request-context helpers, and grants no runtime
`TRUNCATE`. TRA-25 adds product tables and policies. CI runs the G4 integration gate
against PostgreSQL and rejects tenant tables missing `tenant_id NOT NULL`, forced
RLS, a policy, or a tenant-leading index, as well as unsafe runtime ownership or
role grants.

## TRA-19 private storage and video delivery

The `storage` module creates separate private video and asset buckets with
SSE-KMS, bucket keys, public-access blocks, bucket-owner-enforced ownership, TLS-only
bucket policies, explicit KMS-only upload enforcement, browser CORS, and incomplete multipart cleanup. Video objects tagged
`auto-delete-eligible=true` expire after 45 days as the V6 retention safety net.
Application deletion remains authoritative for plan-specific retention.

Video CORS intentionally allows any origin because Established practices can serve
the client app from custom domains (D22). CORS is not the authorization boundary:
uploads still require short-lived credentials scoped to one object key, content type,
and size, while playback still requires an exact-key CloudFront signature. Asset CORS
remains limited to the known coach-app origins.

Private video playback uses CloudFront Price Class 100, Origin Access Control, and a
trusted key group. Every viewer request requires a signed URL. Terraform manages the
public key only. The corresponding private key must never be committed or passed as a
Terraform input because that would place it in state.

The Stage 1 distribution initially uses its generated `cloudfront.net` hostname and
default certificate. CloudFront reports the default certificate with a `TLSv1`
minimum even though modern clients negotiate TLS 1.2 or TLS 1.3. TRA-21 owns the
product-domain alias and ACM certificate that will enforce `TLSv1.2_2021` before
user traffic is enabled.

Generate a distinct RSA key pair for each environment, commit only the public half as
`infra/environments/<environment>/cloudfront-public-key.pem`, and store a JSON secret
containing `cloudfrontPrivateKey`, `cloudfrontPublicKeyId`,
`cloudfrontKeyGroupId`, `cloudfrontDistributionId`,
`cloudfrontDistributionDomain`, and `signedUrlTtlSeconds` in
`traverse/<environment>/video`. ECS secret injection for those fields is owned by
TRA-20. Rotate by adding a second trusted public key, deploying signers with the new
private key, and removing the old key only after existing two-hour URLs have expired.

The API, worker, and video worker receive role-scoped S3 permissions. CloudFront can
read only the video bucket through its exact distribution ARN. The shared KMS policy
admits CloudFront decrypt requests only from distributions in the same AWS account.

## TRA-20 ECS services and deployment pipeline

The `compute` module provides a private ARM64 Fargate cluster, immutable KMS-encrypted
ECR repositories, encrypted service logs, one ECS service each for API, generic worker,
and video worker, plus an on-demand DDL-only migration task. Every service starts with
zero tasks so Terraform can create ECR and ECS safely before the first image exists.
The deployment workflow registers an immutable digest-based revision, runs the migration
task to completion, then scales each service to one task. ECS deployment circuit breakers
roll back unhealthy replacements; every service also has an in-container `/health` check.

GitHub-hosted runners are AMD64. The deployment workflow sets up QEMU emulation and a
Buildx builder before publishing the `linux/arm64` images required by the Fargate task
definitions. This setup is a deployment prerequisite, not an optional optimization.

`main` automatically deploys to NonProd. Production is workflow-dispatch only and uses
the GitHub `production` environment. The current repository plan does not support a
required-reviewer environment rule, so the manual workflow dispatch is the active
production control. Enable a required-reviewer protection rule before any payment or
user-facing production rollout if the repository plan gains support. The
environment-specific GitHub OIDC roles accept only the exact `main` branch subject in
NonProd and the exact `production` environment subject in Prod. They can push only
Traverse ECR images, register/run ECS tasks, update the three services, and pass only
the named ECS roles.

Before first deployment, apply the Compute module in each account so the ECR repositories,
zero-count services, task definitions, and GitHub deployment roles exist. Ensure the
database role bootstrap has populated both database secrets. Then use the deploy workflow
to publish the first immutable images and promote the services after the migration task
succeeds. TRA-21 owns the external HTTPS listener and product-domain ingress; these tasks
remain private until that work is complete.
