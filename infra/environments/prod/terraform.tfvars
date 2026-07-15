infrastructure_profile    = "closed-beta"
vpc_cidr                  = "10.20.0.0/16"
api_domain_name           = "api.traversecoaching.com"
provision_api_certificate = false
enable_api_ingress        = false
storage_asset_cors_allowed_origins = [
  "https://app.traversecoaching.com",
]
