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
minimum even though modern clients negotiate TLS 1.2 or TLS 1.3. The future static
frontend deployment owns any application-domain CloudFront alias and its
`TLSv1.2_2021` certificate. TRA-21 owns the separately protected API ingress at
`api.traversecoaching.com` in production and `staging-api.traversecoaching.com` in
NonProd.

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
Every registered revision also upserts `DEPLOYMENT_ENVIRONMENT` from the workflow into
the cloned task definition. This keeps environment-specific runtime defaults correct even
when the latest AWS revision predates a Terraform task-template change.

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
database role bootstrap has populated both database secrets. Every secret referenced by a
task definition must also have an `AWSCURRENT` version before the first rollout: generate
an authentication secret, provision the video secret, and provision the integration
credentials when their flows are enabled. In NonProd only, explicit placeholders are
acceptable for Resend, Stripe, or AssemblyAI while those integrations are disabled; replace
them with scoped test credentials before enabling the corresponding service flow. Then use
the deploy workflow to publish the first immutable images and promote the services after
the migration task succeeds. TRA-21 owns the external HTTPS listener and product-domain
ingress; these tasks remain private until that work is complete.

## TRA-21 Cloudflare-protected API ingress

The API ingress controls remain deliberately disabled in both environment
`terraform.tfvars` files until the relevant Cloudflare zone is active and Authenticated
Origin Pulls is enabled. The network module refreshes Cloudflare's published IPv4 list on
every Terraform plan or apply and allows ALB port 443 traffic only from those ranges. The
VPC has no IPv6 address space, so there is no IPv6 ALB ingress rule to maintain.

NonProd keeps `provision_api_certificate = true` because its validated certificate is now
a durable managed resource. Production keeps the flag false until its own certificate
request is explicitly authorized. After a certificate is created, keep its environment
flag true. The resource also uses `prevent_destroy`, so intentional certificate removal
requires a separately reviewed lifecycle change instead of an environment flag toggle.

Production exclusively owns `api.traversecoaching.com`. NonProd uses
`staging-api.traversecoaching.com`; the same `staging-*` versus production boundary
applies to the product SPAs. Do not publish a NonProd ACM validation CNAME for the
production hostname. If an earlier certificate request used that hostname, replace it
through Terraform with the configured NonProd hostname before publishing any validation
record.

When an authorised launch owner is ready to perform the controlled activation, use this
sequence for one environment at a time:

1. Request the ACM certificate only. Set `provision_api_certificate = true` in the
   environment's reviewed `terraform.tfvars` change and keep it true after creation. This
   does not create a public listener or change DNS delegation. NonProd already has this
   durable setting after successful validation:

   ```sh
   terraform -chdir=infra/environments/nonprod plan \
     -out=nonprod-api-certificate.tfplan
   terraform -chdir=infra/environments/nonprod apply nonprod-api-certificate.tfplan
   terraform -chdir=infra/environments/nonprod output -json network
   ```

2. Add only the returned environment-specific ACM DNS-validation CNAME in the current
   authoritative DNS provider. Do not change nameservers, MX, or unrelated TXT records.
   Wait for ACM to show `ISSUED`.

3. In Cloudflare, prepare the zone without changing delegation and choose manual DNS entry
   so no live records are imported or altered. Add only an orange-clouded `staging-api`
   CNAME pointing to the NonProd ALB DNS name and configure SSL/TLS mode
   **Full (strict)**. Keep GoDaddy authoritative. Cloudflare disables Authenticated Origin
   Pulls while a zone is pending nameserver activation, so a pending shadow zone is a hard
   stop for listener activation.

4. At the separately approved product-launch DNS cutover, copy every existing GoDaddy
   record into Cloudflare before changing delegation. Preserve the marketing apex, `www`,
   Microsoft 365 MX, and all unrelated TXT records exactly. Update GoDaddy nameservers only
   after that review, wait for Cloudflare to report the zone active, and verify the existing
   marketing and email records before continuing.

   Once the zone is active, enable **Authenticated Origin Pulls** using Cloudflare's global
   certificate. The Terraform trust store uses the matching public CA bundle from
   Cloudflare's official Authenticated Origin Pulls documentation. Review its expiry and
   replace the checked-in bundle before it expires. A per-hostname AOP certificate is a
   stricter future option, but it requires a deliberately provisioned Cloudflare API
   credential and must not be committed to this repository.

5. Enable the listener only after ACM validation, active Cloudflare delegation, and
   verified Authenticated Origin Pulls. Set `enable_api_ingress = true` in the reviewed
   environment file and keep it true after activation so later plans cannot silently
   propose destroying the listener and origin trust resources. Do not rely on a
   command-line variable as the durable source of desired state. The listener has Terraform
   preconditions for both the certificate request and `ISSUED` status.

   A broad NonProd plan can include bootstrap task-definition replacements because GitHub
   Actions owns the deployed immutable ECS revisions. Do not apply those unrelated changes.
   Review and save a network-only exceptional target plan:

   ```sh
   terraform -chdir=infra/environments/nonprod plan \
     -target=module.network \
     -out=nonprod-api-ingress-network.tfplan
   terraform -chdir=infra/environments/nonprod show \
     nonprod-api-ingress-network.tfplan
   terraform -chdir=infra/environments/nonprod apply \
     nonprod-api-ingress-network.tfplan
   ```

   The reviewed NonProd plan creates exactly eight network resources with no changes or
   destroys. It creates an HTTPS-only ALB listener using
   `ELBSecurityPolicy-TLS13-1-2-2021-06`, an IP target group, and ALB mutual TLS
   verification against the Cloudflare AOP CA bundle. A direct request to the ALB must
   fail without a Cloudflare client certificate.

6. Attach the existing API ECS service to the new target group without changing its current
   immutable task definition. This API call starts a rolling ECS deployment, so capture the
   current task-definition ARN before the update and confirm it is unchanged afterward:

   ```sh
   aws ecs describe-services \
     --cluster traverse-nonprod-cluster \
     --services traverse-nonprod-api \
     --profile traverse-nonprod \
     --region us-east-1 \
     --query 'services[0].taskDefinition' \
     --output text

   API_TARGET_GROUP_ARN="$(aws elbv2 describe-target-groups \
     --names traverse-nonprod-api \
     --profile traverse-nonprod \
     --region us-east-1 \
     --query 'TargetGroups[0].TargetGroupArn' \
     --output text)"

   aws ecs update-service \
     --cluster traverse-nonprod-cluster \
     --service traverse-nonprod-api \
     --load-balancers \
       "targetGroupArn=${API_TARGET_GROUP_ARN},containerName=api,containerPort=3000" \
     --profile traverse-nonprod \
     --region us-east-1

   aws ecs wait services-stable \
     --cluster traverse-nonprod-cluster \
     --services traverse-nonprod-api \
     --profile traverse-nonprod \
     --region us-east-1
   ```

   Verify target health and the unchanged task-definition ARN. Then reconcile the
   out-of-band attachment into Terraform state with a reviewed refresh-only plan:

   ```sh
   terraform -chdir=infra/environments/nonprod plan \
     -refresh-only \
     -target='module.compute.aws_ecs_service.service["api"]' \
     -out=nonprod-api-service-refresh.tfplan
   terraform -chdir=infra/environments/nonprod apply \
     nonprod-api-service-refresh.tfplan
   ```

   Validate `https://staging-api.traversecoaching.com/health` through Cloudflare, confirm
   direct ALB access remains rejected, and monitor ALB, ECS, and Cloudflare error metrics
   before enabling test traffic. Production `api` ingress remains a separate, explicitly
   authorized change.

Do not use a Terraform apply as a substitute for an approved DNS cutover. This repository
does not manage the Cloudflare zone or GoDaddy nameservers. If validation fails after the
listener is enabled, preserve the authoritative marketing and email records, stop test
traffic, and use a separately reviewed rollback instead of changing unrelated DNS.

## TRA-30 guarded NonProd static app hosting

The `static-hosting` module defines separate private S3 origins and CloudFront
distributions for the Admin, Billing Admin, Client, and Coach app shells. It is restricted
to NonProd and disabled by default through `enable_static_hosting = false`. A normal plan
therefore creates no static hosting resource and does not change the existing ECS, API
ingress, certificate, DNS, Cloudflare, or production boundaries.

When enabled through an explicitly authorized NonProd Terraform plan and apply, each app
uses only its generated `cloudfront.net` hostname and default CloudFront certificate. The
module creates no aliases, custom certificates, Route 53 records, GoDaddy records, or
Cloudflare configuration. S3 origins block all public access and allow object reads only
from their exact CloudFront distribution through Origin Access Control. Bucket versioning
retains superseded objects for 30 days, and HTTPS responses include the shared browser
security policy.

Extensionless routes are rewritten to `/index.html` by a CloudFront Function. Fingerprinted
files under `assets/` use the managed optimized cache policy and one-year immutable origin
metadata. App routes and entry-point files use the managed disabled cache policy, so static
publication does not need broad CloudFront invalidation permissions.

After the guarded infrastructure is separately reviewed and applied, publication remains
manual. Dispatch `Deploy static apps` from `main` and affirm the NonProd confirmation input.
The workflow has no production target and the OIDC role accepts only the exact `main` branch
subject. Its S3 permissions are scoped to the four static origin buckets. The publication
script also verifies the NonProd account ID before synchronizing any object.

Do not dispatch the workflow before Terraform outputs four populated endpoints. Do not add
application aliases or migrate DNS as part of this sequence. Product-domain activation is a
separate launch operation and remains blocked by its owning certificate, DNS, and ingress
controls.
