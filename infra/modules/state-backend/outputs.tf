output "bucket_name" {
  description = "Terraform state bucket name."
  value       = aws_s3_bucket.state.id
}

output "bucket_arn" {
  description = "Terraform state bucket ARN."
  value       = aws_s3_bucket.state.arn
}
