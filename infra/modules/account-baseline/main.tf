data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name_prefix = "${var.project}-${var.environment}"

  secret_definitions = {
    auth               = { description = "Authentication and session secrets" }
    database           = { description = "Application runtime database credentials" }
    database-migration = { description = "Database migration credentials, isolated from application tasks" }
    stripe             = { description = "Stripe API and webhook credentials" }
    resend             = { description = "Resend email delivery credentials" }
    assemblyai         = { description = "AssemblyAI transcription credentials" }
    video              = { description = "Video processing integration credentials" }
  }

  task_role_secret_access = {
    api          = ["auth", "database", "resend", "stripe"]
    worker       = ["assemblyai", "auth", "database", "resend", "stripe"]
    video-worker = ["assemblyai", "database", "video"]
  }

  direct_kms_roles = toset(["api", "worker", "video-worker"])
}

resource "aws_kms_key" "application" {
  description             = "${var.project} ${var.environment} application and secrets key"
  deletion_window_in_days = var.kms_deletion_window_days
  enable_key_rotation     = true

  lifecycle {
    prevent_destroy = true
  }

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableAccountIAMPolicies"
        Effect = "Allow"
        Principal = {
          AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowCloudWatchLogsEncryption"
        Effect = "Allow"
        Principal = {
          Service = "logs.${var.region}.amazonaws.com"
        }
        Action = [
          "kms:Decrypt*",
          "kms:Describe*",
          "kms:Encrypt*",
          "kms:GenerateDataKey*",
          "kms:ReEncrypt*",
        ]
        Resource = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:*"
          }
        }
      },
      {
        Sid    = "AllowCloudFrontS3OriginDecrypt"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action = [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:GenerateDataKey*",
        ]
        Resource = "*"
        Condition = {
          ArnLike = {
            "AWS:SourceArn" = "arn:${data.aws_partition.current.partition}:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/*"
          }
        }
      }
    ]
  })
}

resource "aws_kms_alias" "application" {
  name          = "alias/${var.project}/${var.environment}/application"
  target_key_id = aws_kms_key.application.key_id
}

resource "aws_secretsmanager_secret" "service" {
  for_each = local.secret_definitions

  name                    = "${var.project}/${var.environment}/${each.key}"
  description             = each.value.description
  kms_key_id              = aws_kms_key.application.arn
  recovery_window_in_days = var.secret_recovery_window_days

  lifecycle {
    prevent_destroy = true
  }
}

data "aws_iam_policy_document" "ecs_tasks_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task" {
  for_each = local.task_role_secret_access

  name               = "${local.name_prefix}-${each.key}-task"
  description        = "Least-privilege ECS task role for the ${each.key} service"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

data "aws_iam_policy_document" "task" {
  for_each = local.task_role_secret_access

  statement {
    sid = "ReadOwnedSecrets"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
    ]
    resources = [
      for secret_name in each.value : aws_secretsmanager_secret.service[secret_name].arn
    ]
  }

  statement {
    sid = "DecryptOwnedSecrets"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.application.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:SecretARN"
      values = [
        for secret_name in each.value : aws_secretsmanager_secret.service[secret_name].arn
      ]
    }
  }

  dynamic "statement" {
    for_each = contains(local.direct_kms_roles, each.key) ? [1] : []

    content {
      sid = "EncryptApplicationContent"
      actions = [
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:Encrypt",
        "kms:GenerateDataKey",
        "kms:ReEncryptFrom",
        "kms:ReEncryptTo",
      ]
      resources = [aws_kms_key.application.arn]
    }
  }
}

resource "aws_iam_role_policy" "task" {
  for_each = local.task_role_secret_access

  name   = "${local.name_prefix}-${each.key}-baseline"
  role   = aws_iam_role.task[each.key].id
  policy = data.aws_iam_policy_document.task[each.key].json
}
