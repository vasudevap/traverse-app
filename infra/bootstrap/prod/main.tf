terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket              = "traverse-terraform-state-491884381572"
    key                 = "bootstrap/terraform.tfstate"
    region              = "us-east-1"
    profile             = "traverse-prod"
    encrypt             = true
    kms_key_id          = "arn:aws:kms:us-east-1:491884381572:alias/traverse/prod/application"
    use_lockfile        = true
    allowed_account_ids = ["491884381572"]
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
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

data "aws_kms_alias" "application" {
  name = "alias/traverse/prod/application"
}

module "state_backend" {
  source = "../../modules/state-backend"

  bucket_name = "traverse-terraform-state-491884381572"
  kms_key_arn = data.aws_kms_alias.application.target_key_arn
}

output "state_bucket_name" {
  description = "Prod Terraform state bucket name."
  value       = module.state_backend.bucket_name
}
