variable "project" {
  description = "Project name used for resource names."
  type        = string
}

variable "environment" {
  description = "Deployment environment."
  type        = string

  validation {
    condition     = contains(["nonprod", "prod"], var.environment)
    error_message = "Environment must be nonprod or prod."
  }
}

variable "infrastructure_profile" {
  description = "H13 infrastructure sizing profile."
  type        = string

  validation {
    condition = contains([
      "closed-beta",
      "production-baseline",
      "higher-availability",
    ], var.infrastructure_profile)
    error_message = "Infrastructure profile must be closed-beta, production-baseline, or higher-availability."
  }
}

variable "region" {
  description = "AWS region for the database."
  type        = string
}

variable "vpc_id" {
  description = "Environment VPC ID."
  type        = string
}

variable "app_subnet_ids" {
  description = "Private app subnet IDs available to the temporary bootstrap host."
  type        = list(string)
}

variable "data_subnet_ids" {
  description = "Isolated data subnet IDs for RDS."
  type        = list(string)
}

variable "app_security_group_ids" {
  description = "Application security groups allowed to connect to PostgreSQL."
  type        = map(string)
}

variable "kms_key_arn" {
  description = "Customer-managed KMS key for RDS, Secrets Manager, and bootstrap storage."
  type        = string
}

variable "runtime_secret_arn" {
  description = "Secrets Manager container for the non-owner runtime credentials."
  type        = string
}

variable "migration_secret_arn" {
  description = "Secrets Manager container for the DDL owner credentials."
  type        = string
}

variable "role_bootstrap_sql_base64" {
  description = "Base64-encoded canonical role and RLS helper SQL."
  type        = string
}

variable "bootstrap_host_enabled" {
  description = "Temporarily create a private host to initialize database roles and secrets."
  type        = bool
  default     = false
}

variable "engine_version" {
  description = "PostgreSQL engine version."
  type        = string
  default     = "18.4"
}

variable "allocated_storage_gib" {
  description = "Initial gp3 storage allocation in GiB."
  type        = number
  default     = 20
}

variable "max_allocated_storage_gib" {
  description = "Maximum storage autoscaling allocation in GiB."
  type        = number
  default     = 100
}

variable "backup_retention_days" {
  description = "Automated backup and point-in-time recovery retention."
  type        = number
}

variable "log_retention_days" {
  description = "CloudWatch retention for PostgreSQL logs."
  type        = number
}
