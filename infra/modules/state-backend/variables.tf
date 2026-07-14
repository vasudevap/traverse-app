variable "bucket_name" {
  description = "Globally unique S3 bucket name for Terraform state."
  type        = string
}

variable "kms_key_arn" {
  description = "Environment KMS key ARN used to encrypt state."
  type        = string
}
