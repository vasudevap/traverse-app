output "summary" {
  description = "ECS, ECR, and controlled deployment identifiers."
  value = {
    cluster_name        = aws_ecs_cluster.this.name
    cluster_arn         = aws_ecs_cluster.this.arn
    deployment_role_arn = aws_iam_role.github_deploy.arn
    ecr_repositories    = { for name, repository in aws_ecr_repository.service : name => repository.repository_url }
    service_names       = { for name, service in aws_ecs_service.service : name => service.name }
    task_definition_families = {
      api          = aws_ecs_task_definition.service["api"].family
      worker       = aws_ecs_task_definition.service["worker"].family
      video-worker = aws_ecs_task_definition.service["video-worker"].family
      migration    = aws_ecs_task_definition.migration.family
    }
  }
}
