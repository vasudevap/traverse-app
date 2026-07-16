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
      | map(select(.name != "DEPLOYMENT_ENVIRONMENT")))
    + [{ name: "DEPLOYMENT_ENVIRONMENT", value: $deployment_environment }]
  )
