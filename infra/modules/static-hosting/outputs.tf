output "sites" {
  description = "Generated NonProd app endpoints and their private origins."
  value = {
    for surface, distribution in aws_cloudfront_distribution.app : surface => {
      bucket_arn       = aws_s3_bucket.app[surface].arn
      bucket_name      = aws_s3_bucket.app[surface].id
      distribution_arn = distribution.arn
      distribution_id  = distribution.id
      domain_name      = distribution.domain_name
      url              = "https://${distribution.domain_name}"
    }
  }
}

output "bucket_arns" {
  description = "Private static origin bucket ARNs keyed by app surface."
  value       = { for surface, bucket in aws_s3_bucket.app : surface => bucket.arn }
}
