mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "124074140404"
      arn        = "arn:aws:iam::124074140404:root"
      user_id    = "124074140404"
    }
  }

  mock_data "aws_cloudfront_cache_policy" {
    defaults = {
      id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    }
  }
}

variables {
  project     = "traverse"
  environment = "nonprod"
}

run "disabled_by_default" {
  command = plan

  assert {
    condition     = length(aws_s3_bucket.app) == 0
    error_message = "The default configuration must not create static origin buckets."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.app) == 0
    error_message = "The default configuration must not create CloudFront distributions."
  }

  assert {
    condition     = length(output.sites) == 0
    error_message = "Disabled static hosting must expose no app endpoints."
  }
}

run "creates_isolated_nonprod_sites" {
  command = plan

  variables {
    enabled = true
  }

  assert {
    condition = toset(keys(aws_s3_bucket.app)) == toset([
      "admin",
      "billing-admin",
      "client",
      "coach",
    ])
    error_message = "Static hosting must create exactly one origin per app surface."
  }

  assert {
    condition = alltrue([
      for surface, bucket in aws_s3_bucket.app :
      bucket.bucket == "traverse-${surface}-app-nonprod-124074140404"
    ])
    error_message = "Static origin names must remain account- and environment-scoped."
  }

  assert {
    condition = alltrue([
      for block in aws_s3_bucket_public_access_block.app :
      block.block_public_acls &&
      block.block_public_policy &&
      block.ignore_public_acls &&
      block.restrict_public_buckets
    ])
    error_message = "Every static origin must block all public S3 access."
  }

  assert {
    condition = alltrue([
      for distribution in aws_cloudfront_distribution.app :
      try(length(distribution.aliases), 0) == 0 &&
      distribution.viewer_certificate[0].cloudfront_default_certificate
    ])
    error_message = "Static previews must use generated CloudFront endpoints without aliases."
  }

  assert {
    condition = alltrue([
      for distribution in aws_cloudfront_distribution.app :
      distribution.default_cache_behavior[0].cache_policy_id == data.aws_cloudfront_cache_policy.caching_disabled.id &&
      distribution.ordered_cache_behavior[0].path_pattern == "assets/*" &&
      distribution.ordered_cache_behavior[0].cache_policy_id == data.aws_cloudfront_cache_policy.caching_optimized.id
    ])
    error_message = "App routes must bypass caching while fingerprinted assets use optimized caching."
  }
}

run "rejects_production" {
  command = plan

  variables {
    environment = "prod"
  }

  expect_failures = [var.environment]
}
