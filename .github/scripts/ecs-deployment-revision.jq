del(
  .taskDefinitionArn,
  .revision,
  .status,
  .requiresAttributes,
  .compatibilities,
  .registeredAt,
  .registeredBy,
  .deregisteredAt
)
| .containerDefinitions[0].image = $image
| .containerDefinitions[0].environment = (
    ((.containerDefinitions[0].environment // [])
      | map(select(.name as $name | [
        "ASSET_BUCKET_NAME",
        "CLIENT_APP_BASE_URL",
        "COACH_APP_BASE_URL",
        "DEPLOYMENT_ENVIRONMENT"
      ] | index($name) | not)))
    + [
      { name: "ASSET_BUCKET_NAME", value: $asset_bucket_name },
      { name: "CLIENT_APP_BASE_URL", value: $client_app_base_url },
      { name: "COACH_APP_BASE_URL", value: $coach_app_base_url },
      { name: "DEPLOYMENT_ENVIRONMENT", value: $deployment_environment }
    ]
  )
