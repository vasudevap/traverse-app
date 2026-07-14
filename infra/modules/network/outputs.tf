output "vpc_id" {
  description = "Environment VPC ID."
  value       = aws_vpc.this.id
}

output "availability_zones" {
  description = "Availability zones used by the network."
  value       = local.azs
}

output "public_subnet_ids" {
  description = "Public ALB and NAT subnet IDs in AZ order."
  value       = [for az in local.azs : aws_subnet.public[az].id]
}

output "app_subnet_ids" {
  description = "Private app subnet IDs in AZ order."
  value       = [for az in local.azs : aws_subnet.app[az].id]
}

output "data_subnet_ids" {
  description = "Isolated private data subnet IDs in AZ order."
  value       = [for az in local.azs : aws_subnet.data[az].id]
}

output "route_table_ids" {
  description = "Route table IDs by subnet tier."
  value = {
    public = aws_route_table.public.id
    app    = aws_route_table.app.id
    data   = aws_route_table.data.id
  }
}

output "nat_gateway_id" {
  description = "Single Phase 0 NAT gateway ID."
  value       = aws_nat_gateway.this.id
}

output "s3_gateway_endpoint_id" {
  description = "S3 gateway endpoint ID attached to the app route table."
  value       = aws_vpc_endpoint.s3.id
}

output "alb" {
  description = "API application load balancer identifiers."
  value = {
    arn               = aws_lb.api.arn
    dns_name          = aws_lb.api.dns_name
    security_group_id = aws_security_group.alb.id
  }
}

output "app_security_group_ids" {
  description = "Private app security groups for later ECS and RDS wiring."
  value = {
    api          = aws_security_group.api.id
    worker       = aws_security_group.worker.id
    video-worker = aws_security_group.video_worker.id
    migration    = aws_security_group.migration.id
  }
}

output "cloudflare_ipv4_cidrs" {
  description = "Cloudflare IPv4 ranges applied to ALB HTTPS ingress."
  value       = sort(tolist(local.cloudflare_ipv4_cidrs))
}

output "infrastructure_profile" {
  description = "Applied H13 infrastructure profile."
  value       = var.infrastructure_profile
}
