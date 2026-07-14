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
