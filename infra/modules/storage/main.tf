data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

locals {
  name_prefix       = "${var.project}-${var.environment}"
  video_bucket_name = "${var.project}-videos-${var.environment}-${data.aws_caller_identity.current.account_id}"
  asset_bucket_name = "${var.project}-assets-${var.environment}-${data.aws_caller_identity.current.account_id}"
  video_origin_id   = "${local.name_prefix}-video-s3"
}

resource "aws_s3_bucket" "videos" {
  bucket = local.video_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket" "assets" {
  bucket = local.asset_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "videos" {
  bucket = aws_s3_bucket.videos.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_ownership_controls" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "videos" {
  bucket = aws_s3_bucket.videos.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "videos" {
  bucket = aws_s3_bucket.videos.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      kms_master_key_id = var.kms_key_arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      kms_master_key_id = var.kms_key_arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "videos" {
  bucket = aws_s3_bucket.videos.id

  cors_rule {
    allowed_headers = ["content-type", "x-amz-*", "x-amz-meta-*"]
    allowed_methods = ["GET", "HEAD", "POST", "PUT"]
    allowed_origins = var.video_cors_allowed_origins
    expose_headers  = ["ETag", "x-amz-request-id"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_cors_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  cors_rule {
    allowed_headers = ["content-type", "x-amz-*", "x-amz-meta-*"]
    allowed_methods = ["GET", "HEAD", "POST", "PUT"]
    allowed_origins = var.asset_cors_allowed_origins
    expose_headers  = ["ETag", "x-amz-request-id"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "videos" {
  bucket = aws_s3_bucket.videos.id

  rule {
    id     = "video-retention-backstop"
    status = "Enabled"

    filter {
      tag {
        key   = "auto-delete-eligible"
        value = "true"
      }
    }

    expiration {
      days = var.video_retention_backstop_days
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = var.multipart_abort_days
    }
  }

  depends_on = [aws_s3_bucket_server_side_encryption_configuration.videos]
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    id     = "expire-export-archives"
    status = "Enabled"

    filter {
      prefix = "exports/"
    }

    expiration {
      days = 8
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = var.multipart_abort_days
    }
  }

  depends_on = [aws_s3_bucket_server_side_encryption_configuration.assets]
}

resource "aws_cloudfront_origin_access_control" "videos" {
  name                              = "${local.name_prefix}-videos"
  description                       = "Private OAC for ${local.video_bucket_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_public_key" "videos" {
  name        = "${local.name_prefix}-video-signed-urls"
  comment     = "Public half of the ${var.environment} video signed-URL key pair"
  encoded_key = var.cloudfront_public_key_pem
}

resource "aws_cloudfront_key_group" "videos" {
  name    = "${local.name_prefix}-video-signed-urls"
  comment = "Trusted key group for private video playback"
  items   = [aws_cloudfront_public_key.videos.id]
}

resource "aws_cloudfront_response_headers_policy" "videos" {
  name    = "${local.name_prefix}-video-playback"
  comment = "CORS and browser security headers for signed video playback"

  cors_config {
    access_control_allow_credentials = false
    origin_override                  = true

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS"]
    }

    access_control_allow_origins {
      items = var.video_cors_allowed_origins
    }

    access_control_expose_headers {
      items = ["Accept-Ranges", "Content-Length", "Content-Range", "ETag"]
    }
  }

  security_headers_config {
    content_type_options {
      override = true
    }

    referrer_policy {
      override        = true
      referrer_policy = "no-referrer"
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
      preload                    = false
    }
  }
}

resource "aws_cloudfront_distribution" "videos" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.project} ${var.environment} private video delivery"
  http_version    = "http2and3"
  price_class     = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.videos.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.videos.id
    origin_id                = local.video_origin_id
  }

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.videos.id
    target_origin_id           = local.video_origin_id
    trusted_key_groups         = [aws_cloudfront_key_group.videos.id]
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = false
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "videos_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.videos.arn,
      "${aws_s3_bucket.videos.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid     = "DenyUploadsWithoutKms"
    effect  = "Deny"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.videos.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }

  statement {
    sid     = "DenyUploadsWithWrongKmsKey"
    effect  = "Deny"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.videos.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [var.kms_key_arn]
    }
  }

  statement {
    sid     = "AllowCloudFrontRead"
    effect  = "Allow"
    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.videos.arn}/*",
    ]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.videos.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "videos" {
  bucket = aws_s3_bucket.videos.id
  policy = data.aws_iam_policy_document.videos_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.videos]
}

data "aws_iam_policy_document" "assets_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.assets.arn,
      "${aws_s3_bucket.assets.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid     = "DenyUploadsWithoutKms"
    effect  = "Deny"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.assets.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }

  statement {
    sid     = "DenyUploadsWithWrongKmsKey"
    effect  = "Deny"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.assets.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [var.kms_key_arn]
    }
  }
}

resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id
  policy = data.aws_iam_policy_document.assets_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.assets]
}

data "aws_iam_policy_document" "api_storage" {
  statement {
    sid = "ListStorageBuckets"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
    ]
    resources = [
      aws_s3_bucket.videos.arn,
      aws_s3_bucket.assets.arn,
    ]
  }

  statement {
    sid = "ManageStorageObjects"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:GetObjectAttributes",
      "s3:GetObjectTagging",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
      "s3:PutObjectTagging",
    ]
    resources = [
      "${aws_s3_bucket.videos.arn}/*",
      "${aws_s3_bucket.assets.arn}/*",
    ]
  }
}

resource "aws_iam_role_policy" "api_storage" {
  name   = "${local.name_prefix}-storage"
  role   = var.task_role_names["api"]
  policy = data.aws_iam_policy_document.api_storage.json
}

data "aws_iam_policy_document" "worker_storage" {
  statement {
    sid = "ListVideoObjects"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.videos.arn]
  }

  statement {
    sid = "ProcessVideoObjects"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:GetObjectAttributes",
      "s3:GetObjectTagging",
      "s3:PutObjectTagging",
    ]
    resources = ["${aws_s3_bucket.videos.arn}/*"]
  }

  statement {
    sid       = "ReadBrandAssets"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.assets.arn}/*"]
  }

  statement {
    sid = "ListExportArchives"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.assets.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["exports/*"]
    }
  }

  statement {
    sid = "WriteExportArchives"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.assets.arn}/exports/*"]
  }
}

resource "aws_iam_role_policy" "worker_storage" {
  name   = "${local.name_prefix}-storage"
  role   = var.task_role_names["worker"]
  policy = data.aws_iam_policy_document.worker_storage.json
}

data "aws_iam_policy_document" "video_worker_storage" {
  statement {
    sid = "ListVideoObjects"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
    ]
    resources = [aws_s3_bucket.videos.arn]
  }

  statement {
    sid = "TranscodeVideoObjects"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:GetObjectAttributes",
      "s3:GetObjectTagging",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
      "s3:PutObjectTagging",
    ]
    resources = ["${aws_s3_bucket.videos.arn}/*"]
  }
}

resource "aws_iam_role_policy" "video_worker_storage" {
  name   = "${local.name_prefix}-storage"
  role   = var.task_role_names["video-worker"]
  policy = data.aws_iam_policy_document.video_worker_storage.json
}
