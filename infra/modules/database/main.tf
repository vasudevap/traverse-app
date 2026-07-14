data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name_prefix = "${var.project}-${var.environment}"

  profile_settings = {
    closed-beta = {
      instance_class = "db.t4g.medium"
      multi_az       = false
    }
    production-baseline = {
      instance_class = "db.m7g.large"
      multi_az       = true
    }
    higher-availability = {
      instance_class = "db.m7g.large"
      multi_az       = true
    }
  }

  database = local.profile_settings[var.infrastructure_profile]
}

resource "aws_db_subnet_group" "this" {
  name       = "${local.name_prefix}-postgres"
  subnet_ids = var.data_subnet_ids

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}

resource "aws_security_group" "database" {
  name        = "${local.name_prefix}-postgres"
  description = "Private PostgreSQL ingress from Traverse application services"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${local.name_prefix}-postgres-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "application" {
  for_each = var.app_security_group_ids

  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from ${each.key}"
  referenced_security_group_id = each.value
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_db_parameter_group" "this" {
  name   = "${local.name_prefix}-postgres18"
  family = "postgres18"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = {
    Name = "${local.name_prefix}-postgres18"
  }
}

resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/instance/${local.name_prefix}-postgres/postgresql"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
}

resource "aws_cloudwatch_log_group" "upgrade" {
  name              = "/aws/rds/instance/${local.name_prefix}-postgres/upgrade"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
}

resource "aws_db_instance" "this" {
  identifier = "${local.name_prefix}-postgres"

  engine                          = "postgres"
  engine_version                  = var.engine_version
  engine_lifecycle_support        = "open-source-rds-extended-support-disabled"
  instance_class                  = local.database.instance_class
  multi_az                        = local.database.multi_az
  db_name                         = "traverse"
  username                        = "traverse_admin"
  port                            = 5432
  manage_master_user_password     = true
  master_user_secret_kms_key_id   = var.kms_key_arn
  parameter_group_name            = aws_db_parameter_group.this.name
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [aws_security_group.database.id]
  publicly_accessible             = false
  storage_type                    = "gp3"
  allocated_storage               = var.allocated_storage_gib
  max_allocated_storage           = var.max_allocated_storage_gib
  storage_encrypted               = true
  kms_key_id                      = var.kms_key_arn
  backup_retention_period         = var.backup_retention_days
  backup_window                   = "05:00-05:30"
  maintenance_window              = "sun:06:00-sun:07:00"
  auto_minor_version_upgrade      = true
  allow_major_version_upgrade     = false
  apply_immediately               = true
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  performance_insights_enabled    = true
  performance_insights_kms_key_id = var.kms_key_arn
  deletion_protection             = var.environment == "prod"
  skip_final_snapshot             = var.environment != "prod"
  final_snapshot_identifier       = "${local.name_prefix}-postgres-final"

  tags = {
    Name    = "${local.name_prefix}-postgres"
    Profile = var.infrastructure_profile
  }

  depends_on = [
    aws_cloudwatch_log_group.postgresql,
    aws_cloudwatch_log_group.upgrade,
  ]
}

resource "aws_cloudwatch_metric_alarm" "cpu_credit_balance" {
  count = var.infrastructure_profile == "closed-beta" ? 1 : 0

  alarm_name          = "${local.name_prefix}-postgres-low-cpu-credits"
  alarm_description   = "PostgreSQL burst CPU credits are approaching exhaustion."
  namespace           = "AWS/RDS"
  metric_name         = "CPUCreditBalance"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.this.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 100
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
}

resource "aws_cloudwatch_metric_alarm" "free_storage_space" {
  alarm_name          = "${local.name_prefix}-postgres-low-storage"
  alarm_description   = "PostgreSQL free storage is below 5 GiB."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.this.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 5368709120
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "missing"
}
