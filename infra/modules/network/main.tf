data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

data "aws_caller_identity" "current" {}

data "http" "cloudflare_ipv4" {
  url = "https://www.cloudflare.com/ips-v4"

  request_headers = {
    Accept = "text/plain"
  }

  lifecycle {
    postcondition {
      condition     = self.status_code == 200
      error_message = "Cloudflare IPv4 ranges could not be retrieved."
    }
  }
}

locals {
  name_prefix = "${var.project}-${var.environment}"
  azs         = slice(data.aws_availability_zones.available.names, 0, 2)

  public_subnets = {
    for index, az in local.azs : az => cidrsubnet(var.vpc_cidr, 8, index)
  }
  app_subnets = {
    for index, az in local.azs : az => cidrsubnet(var.vpc_cidr, 8, index + 10)
  }
  data_subnets = {
    for index, az in local.azs : az => cidrsubnet(var.vpc_cidr, 8, index + 20)
  }

  cloudflare_ipv4_cidrs = toset(compact(split("\n", trimspace(data.http.cloudflare_ipv4.response_body))))
}

check "cloudflare_ipv4_ranges" {
  assert {
    condition = (
      length(local.cloudflare_ipv4_cidrs) > 0 &&
      alltrue([for cidr in local.cloudflare_ipv4_cidrs : can(cidrnetmask(cidr))])
    )
    error_message = "Cloudflare returned an empty or invalid IPv4 range list."
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name    = "${local.name_prefix}-vpc"
    Profile = var.infrastructure_profile
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  for_each = local.public_subnets

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name_prefix}-public-${each.key}"
    Tier = "public"
  }
}

resource "aws_subnet" "app" {
  for_each = local.app_subnets

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name_prefix}-app-${each.key}"
    Tier = "private-app"
  }
}

resource "aws_subnet" "data" {
  for_each = local.data_subnets

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false

  tags = {
    Name = "${local.name_prefix}-data-${each.key}"
    Tier = "private-data"
  }
}

resource "aws_eip" "nat" {
  domain = "vpc"

  tags = {
    Name = "${local.name_prefix}-nat-eip"
  }
}

resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[local.azs[0]].id

  tags = {
    Name = "${local.name_prefix}-nat"
  }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = {
    Name = "${local.name_prefix}-public-rt"
    Tier = "public"
  }
}

resource "aws_route_table" "app" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }

  tags = {
    Name = "${local.name_prefix}-app-rt"
    Tier = "private-app"
  }
}

resource "aws_route_table" "data" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${local.name_prefix}-data-rt"
    Tier = "private-data"
  }
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "app" {
  for_each = aws_subnet.app

  subnet_id      = each.value.id
  route_table_id = aws_route_table.app.id
}

resource "aws_route_table_association" "data" {
  for_each = aws_subnet.data

  subnet_id      = each.value.id
  route_table_id = aws_route_table.data.id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.app.id]

  tags = {
    Name = "${local.name_prefix}-s3-endpoint"
  }
}

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb"
  description = "Cloudflare-only HTTPS ingress to the Traverse ALB"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.name_prefix}-alb-sg"
  }
}

resource "aws_security_group" "api" {
  name        = "${local.name_prefix}-api"
  description = "API tasks in the private app tier"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.name_prefix}-api-sg"
  }
}

resource "aws_security_group" "worker" {
  name        = "${local.name_prefix}-worker"
  description = "Generic worker tasks in the private app tier"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.name_prefix}-worker-sg"
  }
}

resource "aws_security_group" "video_worker" {
  name        = "${local.name_prefix}-video-worker"
  description = "Video worker tasks in the private app tier"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.name_prefix}-video-worker-sg"
  }
}

resource "aws_security_group" "migration" {
  name        = "${local.name_prefix}-migration"
  description = "One-off DDL migration tasks in the private app tier"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = "${local.name_prefix}-migration-sg"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https_cloudflare" {
  for_each = local.cloudflare_ipv4_cidrs

  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from Cloudflare ${each.value}"
  cidr_ipv4         = each.value
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "API traffic and health checks"
  referenced_security_group_id = aws_security_group.api.id
  from_port                    = var.api_port
  to_port                      = var.api_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "API traffic and health checks from the ALB"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.api_port
  to_port                      = var.api_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "app" {
  for_each = {
    api          = aws_security_group.api.id
    worker       = aws_security_group.worker.id
    video-worker = aws_security_group.video_worker.id
    migration    = aws_security_group.migration.id
  }

  security_group_id = each.value
  description       = "Outbound through the private app route table"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_lb" "api" {
  name                       = "${local.name_prefix}-alb"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = [for az in local.azs : aws_subnet.public[az].id]
  drop_invalid_header_fields = true
  enable_deletion_protection = var.environment == "prod"

  tags = {
    Name = "${local.name_prefix}-alb"
  }
}

resource "aws_acm_certificate" "api" {
  count = var.provision_api_certificate ? 1 : 0

  domain_name       = var.api_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${local.name_prefix}-api"
  }
}

resource "aws_s3_bucket" "cloudflare_aop_trust_store" {
  count = var.enable_api_ingress ? 1 : 0

  bucket        = "${local.name_prefix}-aop-trust-${data.aws_caller_identity.current.account_id}"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "cloudflare_aop_trust_store" {
  count = var.enable_api_ingress ? 1 : 0

  bucket                  = aws_s3_bucket.cloudflare_aop_trust_store[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "cloudflare_aop_trust_store" {
  count = var.enable_api_ingress ? 1 : 0

  bucket = aws_s3_bucket.cloudflare_aop_trust_store[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudflare_aop_trust_store" {
  count = var.enable_api_ingress ? 1 : 0

  bucket = aws_s3_bucket.cloudflare_aop_trust_store[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_object" "cloudflare_aop_ca" {
  count = var.enable_api_ingress ? 1 : 0

  bucket       = aws_s3_bucket.cloudflare_aop_trust_store[0].id
  key          = "cloudflare-authenticated-origin-pull-ca.pem"
  source       = "${path.module}/cloudflare-authenticated-origin-pull-ca.pem"
  etag         = filemd5("${path.module}/cloudflare-authenticated-origin-pull-ca.pem")
  content_type = "application/x-pem-file"

  depends_on = [
    aws_s3_bucket_public_access_block.cloudflare_aop_trust_store,
    aws_s3_bucket_versioning.cloudflare_aop_trust_store,
    aws_s3_bucket_server_side_encryption_configuration.cloudflare_aop_trust_store,
  ]
}

resource "aws_lb_trust_store" "cloudflare_aop" {
  count = var.enable_api_ingress ? 1 : 0

  name                                     = "${local.name_prefix}-cloudflare-aop"
  ca_certificates_bundle_s3_bucket         = aws_s3_bucket.cloudflare_aop_trust_store[0].id
  ca_certificates_bundle_s3_key            = aws_s3_object.cloudflare_aop_ca[0].key
  ca_certificates_bundle_s3_object_version = aws_s3_object.cloudflare_aop_ca[0].version_id
}

resource "aws_lb_target_group" "api" {
  count = var.enable_api_ingress ? 1 : 0

  name        = "${local.name_prefix}-api"
  port        = var.api_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.this.id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "api_https" {
  count = var.enable_api_ingress ? 1 : 0

  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = aws_acm_certificate.api[0].arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[0].arn
  }

  mutual_authentication {
    mode                             = "verify"
    trust_store_arn                  = aws_lb_trust_store.cloudflare_aop[0].arn
    advertise_trust_store_ca_names   = "off"
    ignore_client_certificate_expiry = false
  }

  lifecycle {
    precondition {
      condition     = var.provision_api_certificate
      error_message = "Set provision_api_certificate=true and complete DNS validation before enabling API ingress."
    }

    precondition {
      condition     = aws_acm_certificate.api[0].status == "ISSUED"
      error_message = "The api.traversecoaching.com ACM certificate must be ISSUED before the HTTPS listener can be enabled."
    }
  }
}

resource "aws_cloudwatch_log_group" "vpc_flow" {
  name              = "/aws/vpc/${local.name_prefix}"
  retention_in_days = var.flow_log_retention_days
}

data "aws_iam_policy_document" "flow_logs_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "vpc_flow" {
  name               = "${local.name_prefix}-vpc-flow-logs"
  description        = "Publishes rejected VPC flow logs to CloudWatch"
  assume_role_policy = data.aws_iam_policy_document.flow_logs_assume_role.json
}

data "aws_iam_policy_document" "vpc_flow" {
  statement {
    sid = "WriteFlowLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.vpc_flow.arn}:*"]
  }

  statement {
    sid       = "DescribeFlowLogGroups"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "vpc_flow" {
  name   = "${local.name_prefix}-vpc-flow-logs"
  role   = aws_iam_role.vpc_flow.id
  policy = data.aws_iam_policy_document.vpc_flow.json
}

resource "aws_flow_log" "rejected" {
  iam_role_arn             = aws_iam_role.vpc_flow.arn
  log_destination          = aws_cloudwatch_log_group.vpc_flow.arn
  log_destination_type     = "cloud-watch-logs"
  traffic_type             = "REJECT"
  vpc_id                   = aws_vpc.this.id
  max_aggregation_interval = 60

  tags = {
    Name = "${local.name_prefix}-rejected-flow-log"
  }
}
