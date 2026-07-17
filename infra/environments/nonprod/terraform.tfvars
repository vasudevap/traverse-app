infrastructure_profile    = "closed-beta"
vpc_cidr                  = "10.10.0.0/16"
api_domain_name           = "staging-api.traversecoaching.com"
provision_api_certificate = true
enable_api_ingress        = true
enable_static_hosting     = true
static_app_domain_names = {
  client = "staging-client.traversecoaching.com"
  coach  = "staging-app.traversecoaching.com"
}
provision_static_app_certificate = true
enable_static_app_aliases        = true
storage_asset_cors_allowed_origins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "https://staging-app.traversecoaching.com",
  "https://staging-client.traversecoaching.com",
]
