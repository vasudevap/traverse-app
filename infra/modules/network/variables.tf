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
  description = "AWS region for the network."
  type        = string
}

variable "vpc_cidr" {
  description = "IPv4 CIDR assigned to the environment VPC."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "VPC CIDR must be a valid IPv4 CIDR."
  }
}

variable "api_port" {
  description = "Port exposed by the API tasks to the ALB."
  type        = number
  default     = 3000
}

variable "flow_log_retention_days" {
  description = "CloudWatch retention for rejected VPC flow logs."
  type        = number
  default     = 30
}
