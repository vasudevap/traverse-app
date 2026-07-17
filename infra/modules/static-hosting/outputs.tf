output "sites" {
  description = "Generated NonProd app endpoints and their private origins."
  value = {
    for surface, distribution in aws_cloudfront_distribution.app : surface => {
      bucket_arn       = aws_s3_bucket.app[surface].arn
      bucket_name      = aws_s3_bucket.app[surface].id
      distribution_arn = distribution.arn
      distribution_id  = distribution.id
      domain_name      = distribution.domain_name
      generated_url    = "https://${distribution.domain_name}"
      url = contains(local.alias_surfaces, surface) ? (
        "https://${var.app_domain_names[surface]}"
      ) : "https://${distribution.domain_name}"
    }
  }
}

output "bucket_arns" {
  description = "Private static origin bucket ARNs keyed by app surface."
  value       = { for surface, bucket in aws_s3_bucket.app : surface => bucket.arn }
}

output "certificate_dns_validation_records" {
  description = "Cloudflare CNAME records required to validate the retained NonProd app certificate."
  value = var.provision_app_certificate ? [
    for option in aws_acm_certificate.app[0].domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  ] : []
}
