terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "local" {
    path = "../../.state/prod.tfstate"
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

module "account_baseline" {
  source = "../../modules/account-baseline"

  project                     = "traverse"
  environment                 = "prod"
  region                      = "us-east-1"
  kms_deletion_window_days    = 30
  secret_recovery_window_days = 30
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
