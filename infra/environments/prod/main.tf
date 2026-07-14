terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket              = "traverse-terraform-state-491884381572"
    key                 = "environments/prod/terraform.tfstate"
    region              = "us-east-1"
    profile             = "traverse-prod"
    encrypt             = true
    kms_key_id          = "arn:aws:kms:us-east-1:491884381572:alias/traverse/prod/application"
    use_lockfile        = true
    allowed_account_ids = ["491884381572"]
  }
}

provider "aws" {
  region  = "us-east-1"
  profile = "traverse-prod"

  allowed_account_ids = ["491884381572"]

  default_tags {
    tags = {
      Company     = "Grafley"
      Product     = "Traverse"
      Environment = "prod"
      CostCenter  = "Traverse"
      ManagedBy   = "Terraform"
    }
  }
}

module "network" {
  source = "../../modules/network"

  project                 = "traverse"
  environment             = "prod"
  infrastructure_profile  = var.infrastructure_profile
  region                  = "us-east-1"
  vpc_cidr                = var.vpc_cidr
  flow_log_retention_days = 90
}

module "account_baseline" {
  source = "../../modules/account-baseline"

  project                     = "traverse"
  environment                 = "prod"
  region                      = "us-east-1"
  kms_deletion_window_days    = 30
  secret_recovery_window_days = 30
}

module "database" {
  source = "../../modules/database"

  project                   = "traverse"
  environment               = "prod"
  infrastructure_profile    = var.infrastructure_profile
  region                    = "us-east-1"
  vpc_id                    = module.network.vpc_id
  app_subnet_ids            = module.network.app_subnet_ids
  data_subnet_ids           = module.network.data_subnet_ids
  app_security_group_ids    = module.network.app_security_group_ids
  kms_key_arn               = module.account_baseline.kms_key_arn
  runtime_secret_arn        = module.account_baseline.secret_arns["database"]
  migration_secret_arn      = module.account_baseline.secret_arns["database-migration"]
  role_bootstrap_sql_base64 = filebase64("${path.module}/../../../packages/db/sql/roles-and-rls.sql")
  bootstrap_host_enabled    = var.database_bootstrap_host_enabled
  backup_retention_days     = 14
  log_retention_days        = 90
}

module "storage" {
  source = "../../modules/storage"

  project                       = "traverse"
  environment                   = "prod"
  kms_key_arn                   = module.account_baseline.kms_key_arn
  task_role_names               = module.account_baseline.task_role_names
  cloudfront_public_key_pem     = file("${path.module}/cloudfront-public-key.pem")
  video_cors_allowed_origins    = ["*"]
  asset_cors_allowed_origins    = var.storage_asset_cors_allowed_origins
  video_retention_backstop_days = 45
  multipart_abort_days          = 7
}

output "baseline" {
  description = "Prod baseline resource identifiers."
  value = {
    account_id     = module.account_baseline.account_id
    kms_key_arn    = module.account_baseline.kms_key_arn
    secret_arns    = module.account_baseline.secret_arns
    task_role_arns = module.account_baseline.task_role_arns
  }
}

output "network" {
  description = "Prod network baseline."
  value = {
    vpc_id                 = module.network.vpc_id
    availability_zones     = module.network.availability_zones
    public_subnet_ids      = module.network.public_subnet_ids
    app_subnet_ids         = module.network.app_subnet_ids
    data_subnet_ids        = module.network.data_subnet_ids
    route_table_ids        = module.network.route_table_ids
    nat_gateway_id         = module.network.nat_gateway_id
    s3_gateway_endpoint_id = module.network.s3_gateway_endpoint_id
    alb                    = module.network.alb
    app_security_group_ids = module.network.app_security_group_ids
    cloudflare_ipv4_cidrs  = module.network.cloudflare_ipv4_cidrs
    infrastructure_profile = module.network.infrastructure_profile
  }
}

output "database" {
  description = "Prod PostgreSQL foundation."
  value       = module.database.summary
}

output "storage" {
  description = "Prod storage and private video delivery foundation."
  value       = module.storage.summary
}
