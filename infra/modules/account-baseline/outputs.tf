output "account_id" {
  description = "AWS account receiving the baseline."
  value       = data.aws_caller_identity.current.account_id
}

output "kms_key_arn" {
  description = "Application KMS key ARN."
  value       = aws_kms_key.application.arn
}

output "secret_arns" {
  description = "Secret container ARNs keyed by integration name."
  value       = { for name, secret in aws_secretsmanager_secret.service : name => secret.arn }
}

output "task_role_arns" {
  description = "ECS task role ARNs keyed by service name."
  value       = { for name, role in aws_iam_role.task : name => role.arn }
}
