data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name_prefix = "${var.project}-${var.environment}"

  service_definitions = {
    api = {
      command     = ["node", "apps/api/dist/main.js"]
      cpu         = 256
      health_port = 3000
      memory      = 512
      secrets = [
        { name = "AUTH_SECRET", value_from = var.secret_arns["auth"] },
        { name = "DATABASE_SECRET", value_from = var.secret_arns["database"] },
        { name = "RESEND_SECRET", value_from = var.secret_arns["resend"] },
        { name = "STRIPE_SECRET", value_from = var.secret_arns["stripe"] },
        { name = "VIDEO_DELIVERY_SECRET", value_from = var.secret_arns["video"] },
      ]
    }
    worker = {
      command     = ["node", "apps/worker/dist/main.js"]
      cpu         = 256
      health_port = 3001
      memory      = 512
      secrets = [
        { name = "ASSEMBLYAI_SECRET", value_from = var.secret_arns["assemblyai"] },
        { name = "AUTH_SECRET", value_from = var.secret_arns["auth"] },
        { name = "DATABASE_SECRET", value_from = var.secret_arns["database"] },
        { name = "RESEND_SECRET", value_from = var.secret_arns["resend"] },
        { name = "STRIPE_SECRET", value_from = var.secret_arns["stripe"] },
      ]
    }
    video-worker = {
      command     = ["node", "apps/video-worker/dist/main.js"]
      cpu         = 1024
      health_port = 3002
      memory      = 2048
      secrets = [
        { name = "ASSEMBLYAI_SECRET", value_from = var.secret_arns["assemblyai"] },
        { name = "DATABASE_SECRET", value_from = var.secret_arns["database"] },
        { name = "VIDEO_SECRET", value_from = var.secret_arns["video"] },
      ]
    }
  }

  migration_definition = {
    command = ["node", "apps/migrator/dist/main.js"]
    cpu     = 256
    memory  = 512
    secrets = [
      { name = "DATABASE_MIGRATION_SECRET", value_from = var.secret_arns["database-migration"] },
    ]
  }

  repositories = toset(["api", "worker", "video-worker"])
}

resource "aws_ecr_repository" "service" {
  for_each = local.repositories

  name                 = "${local.name_prefix}-${each.key}"
  image_tag_mutability = "IMMUTABLE"

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.kms_key_arn
  }

  image_scanning_configuration {
    scan_on_push = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_ecr_lifecycle_policy" "service" {
  for_each = aws_ecr_repository.service

  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Retain the latest 30 immutable deployment images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "service" {
  for_each = merge(local.service_definitions, { migration = local.migration_definition })

  name              = "/ecs/${local.name_prefix}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.kms_key_arn
}

resource "aws_ecs_cluster" "this" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
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

resource "aws_iam_role" "execution" {
  name               = "${local.name_prefix}-ecs-execution"
  description        = "ECS image pull, log write, and secret injection role"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume_role.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid = "InjectOnlyDeclaredSecrets"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
    ]
    resources = values(var.secret_arns)
  }

  statement {
    sid       = "DecryptInjectedSecrets"
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${local.name_prefix}-ecs-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

resource "aws_ecs_task_definition" "service" {
  for_each = local.service_definitions

  family                   = "${local.name_prefix}-${each.key}"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = var.task_role_arns[each.key]

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = each.key
    image     = "${aws_ecr_repository.service[each.key].repository_url}:${var.bootstrap_image_tag}"
    essential = true
    command   = each.value.command
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "DEPLOYMENT_ENVIRONMENT", value = var.environment },
      { name = "APP_KMS_KEY_ID", value = var.kms_key_arn },
      { name = "COACH_APP_BASE_URL", value = var.environment == "nonprod" ? "https://staging-app.traversecoaching.com" : "https://app.traversecoaching.com" },
      { name = "${upper(replace(each.key, "-", "_"))}_HEALTH_PORT", value = tostring(each.value.health_port) },
    ]
    portMappings = each.key == "api" ? [{
      containerPort = var.api_port
      hostPort      = var.api_port
      protocol      = "tcp"
    }] : []
    secrets = [for secret in each.value.secrets : {
      name      = secret.name
      valueFrom = secret.value_from
    }]
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${each.value.health_port}/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))\""]
      interval    = 30
      retries     = 3
      startPeriod = 20
      timeout     = 5
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.service[each.key].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "migration" {
  family                   = "${local.name_prefix}-migration"
  cpu                      = local.migration_definition.cpu
  memory                   = local.migration_definition.memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = var.task_role_arns["migration"]

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = "migration"
    image     = "${aws_ecr_repository.service["api"].repository_url}:${var.bootstrap_image_tag}"
    essential = true
    command   = local.migration_definition.command
    environment = [
      { name = "NODE_ENV", value = "production" },
    ]
    secrets = [for secret in local.migration_definition.secrets : {
      name      = secret.name
      valueFrom = secret.value_from
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.service["migration"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "service" {
  for_each = local.service_definitions

  name                               = "${local.name_prefix}-${each.key}"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.service[each.key].arn
  desired_count                      = 0
  launch_type                        = "FARGATE"
  enable_execute_command             = true
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  wait_for_steady_state              = false

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.app_subnet_ids
    security_groups  = [var.app_security_group_ids[each.key]]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = each.key == "api" && var.api_target_group_arn != null ? [var.api_target_group_arn] : []

    content {
      target_group_arn = load_balancer.value
      container_name   = each.key
      container_port   = var.api_port
    }
  }

  lifecycle {
    ignore_changes = [desired_count, task_definition]
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "github_deploy_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = var.github_oidc_subjects
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${local.name_prefix}-github-deploy"
  description        = "GitHub Actions deployment role restricted to ${var.github_repository}"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_assume_role.json
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "GetEcrAuthorizationToken"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = length(var.static_site_bucket_arns) > 0 ? [1] : []

    content {
      sid       = "ListStaticAppOrigins"
      actions   = ["s3:GetBucketLocation", "s3:ListBucket"]
      resources = values(var.static_site_bucket_arns)
    }
  }

  dynamic "statement" {
    for_each = length(var.static_site_bucket_arns) > 0 ? [1] : []

    content {
      sid = "PublishStaticAppAssets"
      actions = [
        "s3:DeleteObject",
        "s3:GetObject",
        "s3:PutObject",
      ]
      resources = [for bucket_arn in values(var.static_site_bucket_arns) : "${bucket_arn}/*"]
    }
  }

  statement {
    sid = "PublishTraverseImages"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [for repository in aws_ecr_repository.service : repository.arn]
  }

  statement {
    sid = "DeployEcsTasks"
    actions = [
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "ecs:DescribeTasks",
      "ecs:ListTasks",
      "ecs:RegisterTaskDefinition",
      "ecs:RunTask",
      "ecs:UpdateService",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "PassOnlyTraverseTaskRoles"
    actions   = ["iam:PassRole"]
    resources = concat(values(var.task_role_arns), [aws_iam_role.execution.arn])

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${local.name_prefix}-github-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
