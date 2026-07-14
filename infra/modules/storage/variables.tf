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

variable "kms_key_arn" {
  description = "Customer-managed KMS key used for S3 default encryption."
  type        = string
}

variable "task_role_names" {
  description = "ECS task role names keyed by api, worker, and video-worker."
  type        = map(string)

  validation {
    condition = alltrue([
      for role_name in ["api", "worker", "video-worker"] : contains(keys(var.task_role_names), role_name)
    ])
    error_message = "Task role names must include api, worker, and video-worker."
  }
}

variable "cloudfront_public_key_pem" {
  description = "PEM-encoded RSA public key for CloudFront signed URLs. The private key must never enter Terraform state."
  type        = string

  validation {
    condition     = can(regex("-----BEGIN PUBLIC KEY-----", var.cloudfront_public_key_pem))
    error_message = "CloudFront public key must be a PEM-encoded public key."
  }
}

variable "video_cors_allowed_origins" {
  description = "Browser origins allowed to use presigned video uploads and signed CloudFront playback."
  type        = list(string)

  validation {
    condition     = length(var.video_cors_allowed_origins) > 0
    error_message = "At least one video CORS origin is required."
  }
}

variable "asset_cors_allowed_origins" {
  description = "Browser origins allowed to use presigned brand-asset operations."
  type        = list(string)

  validation {
    condition     = length(var.asset_cors_allowed_origins) > 0
    error_message = "At least one asset CORS origin is required."
  }
}

variable "video_retention_backstop_days" {
  description = "Hard S3 expiration for video objects tagged auto-delete-eligible=true."
  type        = number
  default     = 45

  validation {
    condition     = var.video_retention_backstop_days >= 1
    error_message = "Video retention backstop must be at least one day."
  }
}

variable "multipart_abort_days" {
  description = "Days before incomplete multipart uploads are aborted."
  type        = number
  default     = 7

  validation {
    condition     = var.multipart_abort_days >= 1
    error_message = "Multipart abort window must be at least one day."
  }
}
