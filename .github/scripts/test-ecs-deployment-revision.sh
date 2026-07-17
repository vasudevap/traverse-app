#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
filter="${script_dir}/ecs-deployment-revision.jq"

input_file=$(mktemp)
output_file=$(mktemp)
empty_environment_input=$(mktemp)
empty_environment_output=$(mktemp)
trap 'rm -f "$input_file" "$output_file" "$empty_environment_input" "$empty_environment_output"' EXIT

jq -n '{
  taskDefinitionArn: "arn:aws:ecs:us-east-1:123456789012:task-definition/traverse-nonprod-api:13",
  revision: 13,
  status: "ACTIVE",
  requiresAttributes: [],
  compatibilities: ["FARGATE"],
  registeredAt: "2026-07-16T00:00:00Z",
  registeredBy: "github-actions",
  deregisteredAt: null,
  family: "traverse-nonprod-api",
  cpu: "256",
  containerDefinitions: [{
    name: "api",
    image: "example.invalid/api:old",
    environment: [
      { name: "NODE_ENV", value: "production" },
      { name: "DEPLOYMENT_ENVIRONMENT", value: "prod" }
    ]
  }]
}' >"$input_file"

jq \
  --arg image "123456789012.dkr.ecr.us-east-1.amazonaws.com/traverse-nonprod-api@sha256:test" \
  --arg deployment_environment "nonprod" \
  --arg asset_bucket_name "traverse-assets-nonprod-123456789012" \
  --arg coach_app_base_url "https://staging-app.traversecoaching.com" \
  --arg client_app_base_url "https://staging-client.traversecoaching.com" \
  -f "$filter" \
  "$input_file" >"$output_file"

jq --exit-status '
  .family == "traverse-nonprod-api"
  and .cpu == "256"
  and .containerDefinitions[0].image == "123456789012.dkr.ecr.us-east-1.amazonaws.com/traverse-nonprod-api@sha256:test"
  and (.containerDefinitions[0].environment | length) == 5
  and ([.containerDefinitions[0].environment[] | select(.name == "NODE_ENV" and .value == "production")] | length) == 1
  and ([.containerDefinitions[0].environment[] | select(.name == "DEPLOYMENT_ENVIRONMENT" and .value == "nonprod")] | length) == 1
  and ([.containerDefinitions[0].environment[] | select(.name == "ASSET_BUCKET_NAME" and .value == "traverse-assets-nonprod-123456789012")] | length) == 1
  and ([.containerDefinitions[0].environment[] | select(.name == "COACH_APP_BASE_URL" and .value == "https://staging-app.traversecoaching.com")] | length) == 1
  and ([.containerDefinitions[0].environment[] | select(.name == "CLIENT_APP_BASE_URL" and .value == "https://staging-client.traversecoaching.com")] | length) == 1
  and has("taskDefinitionArn") == false
  and has("revision") == false
  and has("status") == false
  and has("requiresAttributes") == false
  and has("compatibilities") == false
  and has("registeredAt") == false
  and has("registeredBy") == false
  and has("deregisteredAt") == false
' "$output_file" >/dev/null

jq -n '{
  family: "traverse-nonprod-migration",
  containerDefinitions: [{
    name: "migration",
    image: "example.invalid/api:old"
  }]
}' >"$empty_environment_input"

jq \
  --arg image "123456789012.dkr.ecr.us-east-1.amazonaws.com/traverse-nonprod-api@sha256:test" \
  --arg deployment_environment "nonprod" \
  --arg asset_bucket_name "traverse-assets-nonprod-123456789012" \
  --arg coach_app_base_url "https://staging-app.traversecoaching.com" \
  --arg client_app_base_url "https://staging-client.traversecoaching.com" \
  -f "$filter" \
  "$empty_environment_input" >"$empty_environment_output"

jq --exit-status '
  (.containerDefinitions[0].environment | length) == 4
  and ([.containerDefinitions[0].environment[] | select(.name == "DEPLOYMENT_ENVIRONMENT" and .value == "nonprod")] | length) == 1
' "$empty_environment_output" >/dev/null

echo "ECS deployment revision transformation passed."
