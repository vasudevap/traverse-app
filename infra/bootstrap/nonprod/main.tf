terraform {
  required_version = ">= 1.10.0"

  backend "s3" {
    bucket              = "traverse-terraform-state-124074140404"
    key                 = "bootstrap/terraform.tfstate"
    region              = "us-east-1"
    profile             = "traverse-nonprod"
    encrypt             = true
    kms_key_id          = "arn:aws:kms:us-east-1:124074140404:alias/traverse/nonprod/application"
    use_lockfile        = true
    allowed_account_ids = ["124074140404"]
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
  profile = "traverse-nonprod"

  allowed_account_ids = ["124074140404"]

  default_tags {
    tags = {
      Company     = "Grafley"
      Product     = "Traverse"
      Environment = "nonprod"
      CostCenter  = "Traverse"
      ManagedBy   = "Terraform"
    }
  }
}

data "aws_kms_alias" "application" {
  name = "alias/traverse/nonprod/application"
}

module "state_backend" {
  source = "../../modules/state-backend"

  bucket_name = "traverse-terraform-state-124074140404"
  kms_key_arn = data.aws_kms_alias.application.target_key_arn
}

output "state_bucket_name" {
  description = "NonProd Terraform state bucket name."
  value       = module.state_backend.bucket_name
}
