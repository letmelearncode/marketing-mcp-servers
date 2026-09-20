#!/usr/bin/env bash
# Cloud Run entrypoint. Secret Manager injects the two values below as runtime
# environment variables; materialize them into private files because the app's
# configuration deliberately uses file paths.
#
# Required secret-backed variables:
#   CLOUD_RUN_PROJECTS_YAML  complete projects.yaml using an adc credential
#   CLOUD_RUN_MCP_BEARER_TOKEN  random MCP bearer token (at least 32 characters)
set -euo pipefail

: "${CLOUD_RUN_PROJECTS_YAML:?CLOUD_RUN_PROJECTS_YAML is required}"
: "${CLOUD_RUN_MCP_BEARER_TOKEN:?CLOUD_RUN_MCP_BEARER_TOKEN is required}"

umask 077
runtime_dir="${MCP_RUNTIME_DIR:-/tmp/google-marketing-mcp}"
mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"

projects_file="$runtime_dir/projects.yaml"
token_file="$runtime_dir/mcp-bearer.txt"
printf '%s' "$CLOUD_RUN_PROJECTS_YAML" > "$projects_file"
printf '%s' "$CLOUD_RUN_MCP_BEARER_TOKEN" > "$token_file"
chmod 600 "$projects_file" "$token_file"

export PROJECTS_CONFIG="$projects_file"
export MCP_AUTH_TOKEN_FILE="$token_file"
export MCP_TRANSPORT=http
export MCP_HOST=0.0.0.0
export MCP_PORT="${PORT:-8080}"
export MCP_AUTH_MODE=bearer

# A deployment script adds the generated run.app hostname after the first
# deployment. Keep loopback hosts for local health checks and diagnostics.
export MCP_ALLOWED_HOSTS="${MCP_ALLOWED_HOSTS:-localhost,127.0.0.1}"

exec node dist/packages/google-mcp/src/index.js
