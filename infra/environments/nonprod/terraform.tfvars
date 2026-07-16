infrastructure_profile    = "closed-beta"
vpc_cidr                  = "10.10.0.0/16"
api_domain_name           = "staging-api.traversecoaching.com"
provision_api_certificate = true
enable_api_ingress        = true
enable_static_hosting     = false
storage_asset_cors_allowed_origins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
]
