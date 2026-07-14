output "summary" {
  description = "Storage and private video delivery resource identifiers."
  value = {
    video_bucket = {
      name = aws_s3_bucket.videos.id
      arn  = aws_s3_bucket.videos.arn
    }
    asset_bucket = {
      name = aws_s3_bucket.assets.id
      arn  = aws_s3_bucket.assets.arn
    }
    cloudfront = {
      distribution_id   = aws_cloudfront_distribution.videos.id
      distribution_arn  = aws_cloudfront_distribution.videos.arn
      domain_name       = aws_cloudfront_distribution.videos.domain_name
      key_group_id      = aws_cloudfront_key_group.videos.id
      public_key_id     = aws_cloudfront_public_key.videos.id
      signed_url_ttl_s  = 7200
      trusted_key_group = aws_cloudfront_key_group.videos.name
    }
    lifecycle = {
      video_retention_backstop_days = var.video_retention_backstop_days
      multipart_abort_days          = var.multipart_abort_days
    }
  }
}
