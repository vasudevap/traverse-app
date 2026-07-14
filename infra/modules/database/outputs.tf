output "summary" {
  description = "PostgreSQL foundation identifiers and applied H13 sizing."
  value = {
    identifier               = aws_db_instance.this.identifier
    address                  = aws_db_instance.this.address
    port                     = aws_db_instance.this.port
    engine_version           = aws_db_instance.this.engine_version_actual
    instance_class           = aws_db_instance.this.instance_class
    multi_az                 = aws_db_instance.this.multi_az
    security_group_id        = aws_security_group.database.id
    master_secret_arn        = aws_db_instance.this.master_user_secret[0].secret_arn
    runtime_secret_arn       = var.runtime_secret_arn
    migration_secret_arn     = var.migration_secret_arn
    bootstrap_instance_id    = var.bootstrap_host_enabled ? aws_instance.bootstrap[0].id : null
    infrastructure_profile   = var.infrastructure_profile
    cpu_credit_alarm_enabled = var.infrastructure_profile == "closed-beta"
    free_storage_alarm_name  = aws_cloudwatch_metric_alarm.free_storage_space.alarm_name
  }
}
