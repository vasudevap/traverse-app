variable "infrastructure_profile" {
  description = "H13 infrastructure sizing profile."
  type        = string
}

variable "vpc_cidr" {
  description = "Prod VPC CIDR."
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
  description = "Public API hostname reserved for the Cloudflare-protected ALB."
  type        = string
  default     = "api.traversecoaching.com"
}

variable "provision_api_certificate" {
  description = "Request the ACM certificate only. Keep false until the DNS validation record can be added safely."
  type        = bool
  default     = false
}

variable "enable_api_ingress" {
  description = "Enable the ALB HTTPS listener and Cloudflare Authenticated Origin Pulls trust store after ACM validation."
  type        = bool
  default     = false
}
