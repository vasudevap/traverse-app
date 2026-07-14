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
