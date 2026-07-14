data "aws_ami" "bootstrap" {
  count = var.bootstrap_host_enabled ? 1 : 0

  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-arm64"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }
}

resource "aws_security_group" "bootstrap" {
  count = var.bootstrap_host_enabled ? 1 : 0

  name        = "${local.name_prefix}-database-bootstrap"
  description = "Temporary private database role bootstrap host"
  vpc_id      = var.vpc_id

  tags = {
    Name      = "${local.name_prefix}-database-bootstrap-sg"
    Ephemeral = "true"
  }
}

resource "aws_vpc_security_group_egress_rule" "bootstrap" {
  count = var.bootstrap_host_enabled ? 1 : 0

  security_group_id = aws_security_group.bootstrap[0].id
  description       = "Package, AWS API, and database access through the private app route table"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "bootstrap" {
  count = var.bootstrap_host_enabled ? 1 : 0

  security_group_id            = aws_security_group.database.id
  description                  = "Temporary PostgreSQL role bootstrap"
  referenced_security_group_id = aws_security_group.bootstrap[0].id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

data "aws_iam_policy_document" "bootstrap_assume_role" {
  count = var.bootstrap_host_enabled ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "bootstrap" {
  count = var.bootstrap_host_enabled ? 1 : 0

  name               = "${local.name_prefix}-database-bootstrap"
  description        = "Ephemeral role for database role and secret initialization"
  assume_role_policy = data.aws_iam_policy_document.bootstrap_assume_role[0].json

  tags = {
    Ephemeral = "true"
  }
}

resource "aws_iam_role_policy_attachment" "bootstrap_ssm" {
  count = var.bootstrap_host_enabled ? 1 : 0

  role       = aws_iam_role.bootstrap[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "bootstrap" {
  count = var.bootstrap_host_enabled ? 1 : 0

  statement {
    sid = "ReadManagedMasterSecret"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
    ]
    resources = [aws_db_instance.this.master_user_secret[0].secret_arn]
  }

  statement {
    sid = "InitializeApplicationDatabaseSecrets"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:PutSecretValue",
    ]
    resources = [
      var.runtime_secret_arn,
      var.migration_secret_arn,
    ]
  }

  statement {
    sid       = "GenerateDatabasePasswords"
    actions   = ["secretsmanager:GetRandomPassword"]
    resources = ["*"]
  }

  statement {
    sid = "UseSecretsManagerKmsKey"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey",
    ]
    resources = [var.kms_key_arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }

  statement {
    sid = "ReportBootstrapStatus"
    actions = [
      "ec2:CreateTags",
      "ec2:DescribeInstances",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "bootstrap" {
  count = var.bootstrap_host_enabled ? 1 : 0

  name   = "${local.name_prefix}-database-bootstrap"
  role   = aws_iam_role.bootstrap[0].id
  policy = data.aws_iam_policy_document.bootstrap[0].json
}

resource "aws_iam_instance_profile" "bootstrap" {
  count = var.bootstrap_host_enabled ? 1 : 0

  name = "${local.name_prefix}-database-bootstrap"
  role = aws_iam_role.bootstrap[0].name
}

resource "aws_instance" "bootstrap" {
  count = var.bootstrap_host_enabled ? 1 : 0

  ami                    = data.aws_ami.bootstrap[0].id
  instance_type          = "t4g.nano"
  subnet_id              = var.app_subnet_ids[0]
  vpc_security_group_ids = [aws_security_group.bootstrap[0].id]
  iam_instance_profile   = aws_iam_instance_profile.bootstrap[0].name

  associate_public_ip_address          = false
  instance_initiated_shutdown_behavior = "stop"
  user_data_replace_on_change          = true
  user_data = templatefile("${path.module}/bootstrap-user-data.sh.tftpl", {
    region               = var.region
    database_host        = aws_db_instance.this.address
    database_port        = aws_db_instance.this.port
    database_name        = aws_db_instance.this.db_name
    master_secret_arn    = aws_db_instance.this.master_user_secret[0].secret_arn
    runtime_secret_arn   = var.runtime_secret_arn
    migration_secret_arn = var.migration_secret_arn
    role_sql_base64      = var.role_bootstrap_sql_base64
  })

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    encrypted   = true
    kms_key_id  = var.kms_key_arn
    volume_size = 8
    volume_type = "gp3"
  }

  tags = {
    Name              = "${local.name_prefix}-database-bootstrap"
    Ephemeral         = "true"
    DatabaseBootstrap = "Pending"
  }

  depends_on = [
    aws_iam_role_policy.bootstrap,
    aws_iam_role_policy_attachment.bootstrap_ssm,
    aws_vpc_security_group_ingress_rule.bootstrap,
  ]
}
