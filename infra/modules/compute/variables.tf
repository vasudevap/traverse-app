variable "project" {
  description = "Project name used for resource names."
  type        = string
}

variable "environment" {
  description = "Environment receiving the ECS foundation."
  type        = string

  validation {
    condition     = contains(["nonprod", "prod"], var.environment)
    error_message = "Environment must be nonprod or prod."
  }
}

variable "region" {
  description = "AWS region for ECS resources."
  type        = string
}

variable "infrastructure_profile" {
  description = "H13 infrastructure sizing profile."
  type        = string
}

variable "app_subnet_ids" {
  description = "Private app subnets for Fargate tasks."
  type        = list(string)
}

variable "app_security_group_ids" {
  description = "Private security groups keyed by api, worker, video-worker, and migration."
  type        = map(string)

  validation {
    condition = alltrue([
      for service in ["api", "worker", "video-worker", "migration"] : contains(keys(var.app_security_group_ids), service)
    ])
    error_message = "App security groups must include api, worker, video-worker, and migration."
  }
}

variable "api_target_group_arn" {
  description = "Optional ALB target group ARN used to attach the API service when protected public ingress is enabled."
  type        = string
  default     = null
  nullable    = true
}

variable "api_port" {
  description = "API container port registered with the ALB target group."
  type        = number
  default     = 3000
}

variable "task_role_arns" {
  description = "Task IAM role ARNs keyed by api, worker, video-worker, and migration."
  type        = map(string)

  validation {
    condition = alltrue([
      for service in ["api", "worker", "video-worker", "migration"] : contains(keys(var.task_role_arns), service)
    ])
    error_message = "Task IAM roles must include api, worker, video-worker, and migration."
  }
}

variable "secret_arns" {
  description = "Secrets Manager ARNs keyed by integration name."
  type        = map(string)

  validation {
    condition = alltrue([
      for secret in ["auth", "database", "database-migration", "resend", "stripe", "assemblyai", "video"] : contains(keys(var.secret_arns), secret)
    ])
    error_message = "Required ECS secret ARNs are missing."
  }
}

variable "kms_key_arn" {
  description = "Customer-managed key for CloudWatch log encryption."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository allowed to deploy immutable images."
  type        = string
}

variable "github_oidc_subjects" {
  description = "Exact GitHub OIDC subjects permitted to assume the deployment role."
  type        = set(string)
}

variable "static_site_bucket_arns" {
  description = "Private NonProd static origin bucket ARNs the GitHub deployment role may publish to."
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  description = "CloudWatch retention for ECS service logs."
  type        = number
}

variable "bootstrap_image_tag" {
  description = "Immutable placeholder tag used only until the CD workflow registers the first deployment revision."
  type        = string
  default     = "bootstrap"
}
