variable "infrastructure_profile" {
  description = "H13 infrastructure sizing profile."
  type        = string
}

variable "vpc_cidr" {
  description = "NonProd VPC CIDR."
  type        = string
}

variable "database_bootstrap_host_enabled" {
  description = "Temporarily create the private database role bootstrap host."
  type        = bool
  default     = false
}

variable "storage_asset_cors_allowed_origins" {
  description = "Browser origins allowed to manage private brand assets."
  type        = list(string)
}

variable "api_domain_name" {
  description = "NonProd API hostname, isolated from the production Cloudflare-protected ALB."
  type        = string
  default     = "staging-api.traversecoaching.com"
}

variable "provision_api_certificate" {
  description = "Manage the ACM certificate only. Keep false until validation can proceed safely, then keep true after creation."
  type        = bool
  default     = false
}

variable "enable_api_ingress" {
  description = "Enable the ALB HTTPS listener and Cloudflare Authenticated Origin Pulls trust store after ACM validation."
  type        = bool
  default     = false
}

variable "enable_static_hosting" {
  description = "Create provider-hosted CloudFront endpoints for the four NonProd app shells."
  type        = bool
  default     = false
}
