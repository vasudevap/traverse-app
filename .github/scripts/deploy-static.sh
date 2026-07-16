#!/usr/bin/env bash
set -euo pipefail

required_account_id="124074140404"

if [[ "${DEPLOYMENT_ENVIRONMENT:-}" != "nonprod" ]]; then
  echo "Static app publication is restricted to DEPLOYMENT_ENVIRONMENT=nonprod." >&2
  exit 1
fi

actual_account_id="$(aws sts get-caller-identity --query Account --output text)"

if [[ "$actual_account_id" != "$required_account_id" ]]; then
  echo "Refusing static publication to AWS account $actual_account_id." >&2
  exit 1
fi

surfaces=(admin billing-admin client coach)

for surface in "${surfaces[@]}"; do
  dist_dir="apps/${surface}/dist"
  bucket="traverse-${surface}-app-nonprod-${required_account_id}"

  if [[ ! -f "${dist_dir}/index.html" ]]; then
    echo "Missing ${dist_dir}/index.html. Run the workspace build first." >&2
    exit 1
  fi

  aws s3 sync "$dist_dir" "s3://${bucket}" \
    --delete \
    --exclude "assets/*" \
    --cache-control "no-cache, no-store, must-revalidate"

  if [[ -d "${dist_dir}/assets" ]]; then
    aws s3 sync "${dist_dir}/assets" "s3://${bucket}/assets" \
      --delete \
      --cache-control "public, max-age=31536000, immutable"
  fi
done
