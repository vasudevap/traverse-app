variable "project" {
  description = "Project name used for static hosting resource names."
  type        = string
}

variable "environment" {
  description = "Environment receiving the static hosting foundation."
  type        = string

  validation {
    condition     = var.environment == "nonprod"
    error_message = "Static app hosting is currently restricted to nonprod."
  }
}

variable "enabled" {
  description = "Create the guarded NonProd static hosting resources."
  type        = bool
  default     = false
}

variable "app_domain_names" {
  description = "Authorized NonProd application hostnames keyed by static app surface."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for surface, hostname in var.app_domain_names :
      contains(["admin", "billing-admin", "client", "coach"], surface) &&
      can(regex("^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$", hostname))
    ])
    error_message = "App domain names must use known surfaces and valid lower-case DNS hostnames."
  }
}

variable "asset_upload_origin" {
  description = "Private asset-bucket origin allowed for browser uploads and signed image reads."
  type        = string

  validation {
    condition     = can(regex("^https://[a-z0-9][a-z0-9.-]*\\.amazonaws\\.com$", var.asset_upload_origin))
    error_message = "Asset upload origin must be an HTTPS Amazon S3 origin."
  }
}

variable "provision_app_certificate" {
  description = "Request and retain the shared NonProd CloudFront certificate before alias activation."
  type        = bool
  default     = false
}

variable "enable_app_aliases" {
  description = "Attach authorized NonProd aliases only after the shared certificate is issued."
  type        = bool
  default     = false
}

variable "noncurrent_version_retention_days" {
  description = "Days to retain superseded static asset versions for rollback."
  type        = number
  default     = 30

  validation {
    condition     = var.noncurrent_version_retention_days >= 1
    error_message = "Noncurrent static asset versions must be retained for at least one day."
  }
}
