#!/usr/bin/env bash
set -Eeuo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${DEPLOYMENT_ENVIRONMENT:?DEPLOYMENT_ENVIRONMENT is required}"
: "${ECS_CLUSTER:?ECS_CLUSTER is required}"
: "${ECR_REGISTRY:?ECR_REGISTRY is required}"
: "${IMAGE_DIGEST:?IMAGE_DIGEST is required}"

register_deployment_revision() {
  local family="$1"
  local image="$2"
  local source_file registered_file task_definition_arn

  source_file=$(mktemp)
  registered_file=$(mktemp)

  aws ecs describe-task-definition \
    --region "$AWS_REGION" \
    --task-definition "$family" \
    --query taskDefinition \
    --output json >"$source_file"

  jq --arg image "$image" '
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
  ' "$source_file" >"$registered_file"

  task_definition_arn=$(aws ecs register-task-definition \
    --region "$AWS_REGION" \
    --cli-input-json "file://$registered_file" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

  rm -f "$source_file" "$registered_file"
  printf '%s\n' "$task_definition_arn"
}

api_service="traverse-${DEPLOYMENT_ENVIRONMENT}-api"
api_image="${ECR_REGISTRY}/traverse-${DEPLOYMENT_ENVIRONMENT}-api@${IMAGE_DIGEST}"

migration_task_definition=$(register_deployment_revision "traverse-${DEPLOYMENT_ENVIRONMENT}-migration" "$api_image")
network_configuration=$(aws ecs describe-services \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --services "$api_service" \
  --query 'services[0].networkConfiguration' \
  --output json)

migration_task_arn=$(aws ecs run-task \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$migration_task_definition" \
  --network-configuration "$network_configuration" \
  --query 'tasks[0].taskArn' \
  --output text)

aws ecs wait tasks-stopped \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --tasks "$migration_task_arn"

aws ecs describe-tasks \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --tasks "$migration_task_arn" \
  --output json \
  | jq --exit-status '.tasks[0].containers[] | select(.name == "migration") | .exitCode == 0' >/dev/null

for service in api worker video-worker; do
  image="${ECR_REGISTRY}/traverse-${DEPLOYMENT_ENVIRONMENT}-${service}@${IMAGE_DIGEST}"
  task_definition=$(register_deployment_revision "traverse-${DEPLOYMENT_ENVIRONMENT}-${service}" "$image")

  aws ecs update-service \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --service "traverse-${DEPLOYMENT_ENVIRONMENT}-${service}" \
    --task-definition "$task_definition" \
    --desired-count 1 \
    --force-new-deployment >/dev/null

  aws ecs wait services-stable \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --services "traverse-${DEPLOYMENT_ENVIRONMENT}-${service}"
done
