# Traverse AWS infrastructure

This directory contains the Terraform-managed AWS infrastructure for Traverse.

## TRA-16 account baseline

The `account-baseline` module creates the environment-specific security baseline:

- one customer-managed KMS key with rotation enabled
- empty Secrets Manager containers under `traverse/<environment>/...`
- separate ECS task roles for the API, generic worker, and video worker
- resource policies scoped to only the secrets and KMS operations each service needs

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

TRA-16 uses local bootstrap state under `infra/.state/`, which is ignored by Git.
TRA-17 owns the remote S3 state backend and lock configuration. Migrate these state
files into the TRA-17 backends before making later infrastructure changes.

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

The AWS provider has an allowed-account guard, so an environment cannot be applied
to the other Traverse account accidentally.
