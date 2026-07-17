#!/usr/bin/env bash
set -Eeuo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${DEPLOYMENT_ENVIRONMENT:?DEPLOYMENT_ENVIRONMENT is required}"
: "${ECS_CLUSTER:?ECS_CLUSTER is required}"
: "${ECR_REGISTRY:?ECR_REGISTRY is required}"
: "${IMAGE_DIGEST:?IMAGE_DIGEST is required}"
: "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}"

STABILITY_OBSERVATION_SECONDS="${STABILITY_OBSERVATION_SECONDS:-130}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

register_deployment_revision() {
  local family="$1"
  local image="$2"
  local source_file registered_file task_definition_arn
  local asset_bucket_name="traverse-assets-${DEPLOYMENT_ENVIRONMENT}-${AWS_ACCOUNT_ID}"
  local coach_app_base_url="https://app.traversecoaching.com"
  local client_app_base_url="https://client.traversecoaching.com"

  if [[ "$DEPLOYMENT_ENVIRONMENT" == "nonprod" ]]; then
    coach_app_base_url="https://staging-app.traversecoaching.com"
    client_app_base_url="https://staging-client.traversecoaching.com"
  fi

  source_file=$(mktemp)
  registered_file=$(mktemp)

  aws ecs describe-task-definition \
    --region "$AWS_REGION" \
    --task-definition "$family" \
    --query taskDefinition \
    --output json >"$source_file"

  jq \
    --arg image "$image" \
    --arg deployment_environment "$DEPLOYMENT_ENVIRONMENT" \
    --arg asset_bucket_name "$asset_bucket_name" \
    --arg coach_app_base_url "$coach_app_base_url" \
    --arg client_app_base_url "$client_app_base_url" \
    -f "$SCRIPT_DIR/ecs-deployment-revision.jq" \
    "$source_file" >"$registered_file"

  task_definition_arn=$(aws ecs register-task-definition \
    --region "$AWS_REGION" \
    --cli-input-json "file://$registered_file" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text)

  rm -f "$source_file" "$registered_file"
  printf '%s\n' "$task_definition_arn"
}

running_task_arns() {
  local service task_arns
  local running_tasks=()

  for service in "$@"; do
    task_arns=$(aws ecs list-tasks \
      --region "$AWS_REGION" \
      --cluster "$ECS_CLUSTER" \
      --service-name "$service" \
      --desired-status RUNNING \
      --query 'taskArns' \
      --output text)

    if [[ -z "$task_arns" || "$task_arns" == "None" || "$task_arns" == *$'\t'* ]]; then
      printf 'Expected exactly one running task for %s, found: %s\n' "$service" "$task_arns" >&2
      return 1
    fi
    running_tasks+=("$task_arns")
  done

  printf '%s\n' "${running_tasks[*]}"
}

print_service_diagnostics() {
  local service="$1"
  local stopped_tasks

  printf 'ECS service did not stabilize: %s\n' "$service" >&2
  aws ecs describe-services \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --services "$service" \
    --query 'services[0].{
      serviceName: serviceName,
      desiredCount: desiredCount,
      runningCount: runningCount,
      pendingCount: pendingCount,
      deployments: deployments[].{
        status: status,
        rolloutState: rolloutState,
        rolloutStateReason: rolloutStateReason,
        taskDefinition: taskDefinition,
        desiredCount: desiredCount,
        runningCount: runningCount,
        pendingCount: pendingCount,
        failedTasks: failedTasks
      },
      events: events[0:10].{createdAt: createdAt, message: message}
    }' \
    --output json >&2 || true

  stopped_tasks=$(aws ecs list-tasks \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --service-name "$service" \
    --desired-status STOPPED \
    --max-results 10 \
    --query 'taskArns' \
    --output text || true)

  if [[ -n "$stopped_tasks" && "$stopped_tasks" != "None" ]]; then
    aws ecs describe-tasks \
      --region "$AWS_REGION" \
      --cluster "$ECS_CLUSTER" \
      --tasks $stopped_tasks \
      --query 'tasks[].{
        taskArn: taskArn,
        lastStatus: lastStatus,
        stopCode: stopCode,
        stoppedReason: stoppedReason,
        containers: containers[].{
          name: name,
          lastStatus: lastStatus,
          exitCode: exitCode,
          reason: reason,
          healthStatus: healthStatus
        }
      }' \
      --output json >&2 || true
  fi
}

wait_for_service_stable() {
  local service="$1"

  if ! aws ecs wait services-stable \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --services "$service"; then
    print_service_diagnostics "$service"
    return 1
  fi
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

migration_task=$(aws ecs describe-tasks \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --tasks "$migration_task_arn" \
  --output json \
)

if ! jq --exit-status '.tasks[0].containers[] | select(.name == "migration") | .exitCode == 0' \
  <<<"$migration_task" >/dev/null; then
  echo "Migration task failed: $migration_task_arn" >&2
  jq -c '.tasks[0] | {
    taskArn,
    lastStatus,
    stopCode,
    stoppedReason,
    containers: [.containers[] | {name, lastStatus, exitCode, reason}]
  }' <<<"$migration_task" >&2
  exit 1
fi

services=(api worker video-worker)

for service in "${services[@]}"; do
  image="${ECR_REGISTRY}/traverse-${DEPLOYMENT_ENVIRONMENT}-${service}@${IMAGE_DIGEST}"
  task_definition=$(register_deployment_revision "traverse-${DEPLOYMENT_ENVIRONMENT}-${service}" "$image")

  aws ecs update-service \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --service "traverse-${DEPLOYMENT_ENVIRONMENT}-${service}" \
    --task-definition "$task_definition" \
    --desired-count 1 \
    --force-new-deployment >/dev/null

  wait_for_service_stable "traverse-${DEPLOYMENT_ENVIRONMENT}-${service}"
done

service_names=()
for service in "${services[@]}"; do
  service_names+=("traverse-${DEPLOYMENT_ENVIRONMENT}-${service}")
done

initial_tasks=$(running_task_arns "${service_names[@]}")

printf 'Observing ECS task stability for %s seconds.\n' "$STABILITY_OBSERVATION_SECONDS"
sleep "$STABILITY_OBSERVATION_SECONDS"

if ! aws ecs wait services-stable \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --services "${service_names[@]}"; then
  for service in "${service_names[@]}"; do
    print_service_diagnostics "$service"
  done
  exit 1
fi

final_tasks=$(running_task_arns "${service_names[@]}")

if [[ "$initial_tasks" != "$final_tasks" ]]; then
  printf 'ECS tasks changed during the stability observation window.\n' >&2
  printf 'Initial tasks: %s\n' "$initial_tasks" >&2
  printf 'Final tasks: %s\n' "$final_tasks" >&2
  exit 1
fi
