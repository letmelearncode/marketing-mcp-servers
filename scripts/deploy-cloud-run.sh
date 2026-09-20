#!/usr/bin/env bash
# Deploy the combined, read-only MCP server to Cloud Run using the current
# gcloud account. This script creates only secrets and a Cloud Run service in
# the selected project; it never prints secret values.
set -euo pipefail

: "${GOOGLE_CLOUD_PROJECT:?Set GOOGLE_CLOUD_PROJECT to the deployment project ID}"

service_name="${CLOUD_RUN_SERVICE:-google-marketing-mcp}"
region="${CLOUD_RUN_REGION:-asia-south1}"
service_account="${CLOUD_RUN_SERVICE_ACCOUNT:?Set CLOUD_RUN_SERVICE_ACCOUNT to the runtime service-account email}"
projects_file="${CLOUD_RUN_PROJECTS_FILE:-config/cloud-run-projects.yaml}"
token_file="${CLOUD_RUN_BEARER_TOKEN_FILE:-secrets/mcp-bearer.txt}"

if [ ! -r "$projects_file" ]; then
  echo "Cloud Run project configuration file is missing or unreadable." >&2
  exit 1
fi
if [ ! -r "$token_file" ]; then
  echo "MCP bearer-token file is missing or unreadable." >&2
  exit 1
fi
if [ "$(wc -c < "$token_file" | tr -d ' ')" -lt 32 ]; then
  echo "MCP bearer token must contain at least 32 characters." >&2
  exit 1
fi

gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com \
  --project "$GOOGLE_CLOUD_PROJECT"

# add-version preserves previous working secret versions for safe rollback.
for secret in google-marketing-mcp-projects google-marketing-mcp-bearer; do
  if ! gcloud secrets describe "$secret" --project "$GOOGLE_CLOUD_PROJECT" >/dev/null 2>&1; then
    gcloud secrets create "$secret" --replication-policy=automatic --project "$GOOGLE_CLOUD_PROJECT"
  fi
done
gcloud secrets versions add google-marketing-mcp-projects --data-file "$projects_file" --project "$GOOGLE_CLOUD_PROJECT" >/dev/null
gcloud secrets versions add google-marketing-mcp-bearer --data-file "$token_file" --project "$GOOGLE_CLOUD_PROJECT" >/dev/null

for secret in google-marketing-mcp-projects google-marketing-mcp-bearer; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member "serviceAccount:$service_account" \
    --role roles/secretmanager.secretAccessor \
    --project "$GOOGLE_CLOUD_PROJECT" >/dev/null
done

# First deployment establishes the stable Cloud Run hostname. The application
# starts with a restrictive loopback-only host list, so public MCP calls cannot
# succeed until the second, hostname-pinning revision below.
gcloud run deploy "$service_name" \
  --source . \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region "$region" \
  --service-account "$service_account" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --concurrency 10 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 70s \
  --command bash \
  --args scripts/cloud-run-start.sh \
  --set-secrets CLOUD_RUN_PROJECTS_YAML=google-marketing-mcp-projects:latest,CLOUD_RUN_MCP_BEARER_TOKEN=google-marketing-mcp-bearer:latest \
  --set-env-vars '^@^MCP_ALLOWED_HOSTS=localhost,127.0.0.1' \
  --quiet

service_url="$(gcloud run services describe "$service_name" --project "$GOOGLE_CLOUD_PROJECT" --region "$region" --format='value(status.url)')"
service_host="${service_url#https://}"
gcloud run services update "$service_name" \
  --project "$GOOGLE_CLOUD_PROJECT" \
  --region "$region" \
  --update-env-vars "^@^MCP_ALLOWED_HOSTS=localhost,127.0.0.1,$service_host" \
  --quiet >/dev/null

printf 'Cloud Run MCP endpoint: %s/mcp\n' "$service_url"
