data "aws_caller_identity" "current" {}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

locals {
  surfaces = var.enabled ? toset([
    "admin",
    "billing-admin",
    "client",
    "coach",
  ]) : toset([])
  name_prefix = "${var.project}-${var.environment}"
}

resource "aws_s3_bucket" "app" {
  for_each = local.surfaces

  bucket = "${var.project}-${each.key}-app-${var.environment}-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "app" {
  for_each = local.surfaces

  bucket = aws_s3_bucket.app[each.key].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "app" {
  for_each = local.surfaces

  bucket = aws_s3_bucket.app[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  for_each = local.surfaces

  bucket = aws_s3_bucket.app[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "app" {
  for_each = local.surfaces

  bucket = aws_s3_bucket.app[each.key].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "app" {
  for_each = local.surfaces

  bucket = aws_s3_bucket.app[each.key].id

  rule {
    id     = "expire-superseded-static-assets"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.app]
}

resource "aws_cloudfront_origin_access_control" "app" {
  count = var.enabled ? 1 : 0

  name                              = "${local.name_prefix}-static-apps"
  description                       = "Private OAC for ${var.project} ${var.environment} app shells"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "spa_rewrite" {
  count = var.enabled ? 1 : 0

  name    = "${local.name_prefix}-spa-rewrite"
  comment = "Rewrite extensionless app routes to the SPA entry point"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JAVASCRIPT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;

      if (uri === '/' || uri.indexOf('.') === -1) {
        request.uri = '/index.html';
      }

      return request;
    }
  JAVASCRIPT
}

resource "aws_cloudfront_response_headers_policy" "app" {
  count = var.enabled ? 1 : 0

  name    = "${local.name_prefix}-static-app-security"
  comment = "Browser security headers for generated NonProd app endpoints"

  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'self'; base-uri 'self'; connect-src 'self' https://staging-api.traversecoaching.com; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'"
      override                = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      override        = true
      referrer_policy = "strict-origin-when-cross-origin"
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
      preload                    = false
    }
  }
}

resource "aws_cloudfront_distribution" "app" {
  for_each = local.surfaces

  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project} ${var.environment} ${each.key} app"
  default_root_object = "index.html"
  http_version        = "http2and3"
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.app[each.key].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.app[0].id
    origin_id                = "${local.name_prefix}-${each.key}-s3"
  }

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.app[0].id
    target_origin_id           = "${local.name_prefix}-${each.key}-s3"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite[0].arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "assets/*"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.app[0].id
    target_origin_id           = "${local.name_prefix}-${each.key}-s3"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
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

data "aws_iam_policy_document" "app_bucket" {
  for_each = local.surfaces

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.app[each.key].arn,
      "${aws_s3_bucket.app[each.key].arn}/*",
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
    sid       = "AllowCloudFrontReadOnly"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.app[each.key].arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.app[each.key].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "app" {
  for_each = local.surfaces

  bucket = aws_s3_bucket.app[each.key].id
  policy = data.aws_iam_policy_document.app_bucket[each.key].json
}
