#!/usr/bin/env bash
set -Eeuo pipefail

: "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}"
: "${AWS_REGION:?AWS_REGION is required}"
: "${ECS_CLUSTER:?ECS_CLUSTER is required}"
: "${RESET_CONFIRMATION:?RESET_CONFIRMATION is required}"

readonly EXPECTED_ACCOUNT_ID='124074140404'
readonly EXPECTED_CONFIRMATION='RESET_NONPROD_TEST_DATA'
readonly MIGRATION_TASK_FAMILY='traverse-nonprod-migration'
readonly RESET_SERVICES=(
  'traverse-nonprod-api'
  'traverse-nonprod-worker'
  'traverse-nonprod-video-worker'
)

if [[ "$AWS_ACCOUNT_ID" != "$EXPECTED_ACCOUNT_ID" ]]; then
  printf 'Refusing reset outside the NonProd AWS account.\n' >&2
  exit 1
fi

if [[ "$RESET_CONFIRMATION" != "$EXPECTED_CONFIRMATION" ]]; then
  printf 'Refusing reset without the exact NonProd confirmation.\n' >&2
  exit 1
fi

actual_account_id=$(aws sts get-caller-identity --query Account --output text)
if [[ "$actual_account_id" != "$EXPECTED_ACCOUNT_ID" ]]; then
  printf 'Refusing reset because the assumed AWS account is not NonProd.\n' >&2
  exit 1
fi

declare -A original_desired_counts
for service in "${RESET_SERVICES[@]}"; do
  original_desired_counts["$service"]=$(aws ecs describe-services \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --services "$service" \
    --query 'services[0].desiredCount' \
    --output text)
done

restore_services() {
  local status=0

  for service in "${RESET_SERVICES[@]}"; do
    aws ecs update-service \
      --region "$AWS_REGION" \
      --cluster "$ECS_CLUSTER" \
      --service "$service" \
      --desired-count "${original_desired_counts[$service]}" >/dev/null || status=1
  done

  for service in "${RESET_SERVICES[@]}"; do
    aws ecs wait services-stable \
      --region "$AWS_REGION" \
      --cluster "$ECS_CLUSTER" \
      --services "$service" || status=1
  done

  return "$status"
}

restore_on_exit() {
  local exit_status=$?
  trap - EXIT

  printf 'Restoring staging services to their prior desired counts.\n'
  restore_services || exit_status=1
  exit "$exit_status"
}

trap restore_on_exit EXIT

network_configuration=$(aws ecs describe-services \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --services 'traverse-nonprod-api' \
  --query 'services[0].networkConfiguration' \
  --output json)

for service in "${RESET_SERVICES[@]}"; do
  aws ecs update-service \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --service "$service" \
    --desired-count 0 >/dev/null
done

for service in "${RESET_SERVICES[@]}"; do
  aws ecs wait services-stable \
    --region "$AWS_REGION" \
    --cluster "$ECS_CLUSTER" \
    --services "$service"
done

task_overrides=$(jq -n \
  --arg confirmation "$RESET_CONFIRMATION" \
  '{containerOverrides: [{
    name: "migration",
    command: ["node", "apps/migrator/dist/main.js", "reset-nonprod-test-data"],
    environment: [
      {name: "DEPLOYMENT_ENVIRONMENT", value: "nonprod"},
      {name: "RESET_NONPROD_TEST_DATA", value: $confirmation}
    ]
  }]}')

reset_task_arn=$(aws ecs run-task \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$MIGRATION_TASK_FAMILY" \
  --network-configuration "$network_configuration" \
  --overrides "$task_overrides" \
  --query 'tasks[0].taskArn' \
  --output text)

if [[ -z "$reset_task_arn" || "$reset_task_arn" == 'None' ]]; then
  printf 'NonProd reset task was not started.\n' >&2
  exit 1
fi

aws ecs wait tasks-stopped \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --tasks "$reset_task_arn"

reset_task=$(aws ecs describe-tasks \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --tasks "$reset_task_arn" \
  --output json)

if ! jq --exit-status '.tasks[0].containers[] | select(.name == "migration") | .exitCode == 0' \
  <<<"$reset_task" >/dev/null; then
  printf 'NonProd test-data reset task failed: %s\n' "$reset_task_arn" >&2
  jq -c '.tasks[0] | {taskArn, stoppedReason, containers: [.containers[] | {name, exitCode, reason}]}' \
    <<<"$reset_task" >&2
  exit 1
fi

printf 'NonProd test-data reset completed and was verified by the migration task.\n'
