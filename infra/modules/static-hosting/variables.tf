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

variable "noncurrent_version_retention_days" {
  description = "Days to retain superseded static asset versions for rollback."
  type        = number
  default     = 30

  validation {
    condition     = var.noncurrent_version_retention_days >= 1
    error_message = "Noncurrent static asset versions must be retained for at least one day."
  }
}
