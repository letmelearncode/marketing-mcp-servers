#!/usr/bin/env bash
# Render entrypoint: materialize file-based config/secrets from environment
# variables (Render has no persistent uploads), then start the HTTP server.
#
# Required Render env vars (set in dashboard, marked sensitive):
#   RENDER_MCP_BEARER_TOKEN   static MCP bearer token (>= 32 chars)
#   RENDER_PROJECTS_YAML      full contents of config/projects.yaml
#   RENDER_SERVICE_ACCOUNT_JSON  Google service-account key JSON
#     (service_account profile; avoids the interactive OAuth helper, which
#      cannot run on Render)
#
# Only needed when a credential profile uses type: oauth (authorize locally,
# then paste the values):
#   RENDER_TOKEN_ENCRYPTION_KEY  64 hex chars
#   RENDER_OAUTH_CLIENT_JSON     Desktop-app OAuth client JSON
#   RENDER_GOOGLE_TOKEN_ENC      encrypted refresh token from oauth-setup
set -euo pipefail

export MCP_TRANSPORT="${MCP_TRANSPORT:-http}"
export MCP_HOST="${MCP_HOST:-0.0.0.0}"
# Render injects $PORT; the app reads MCP_PORT.
export MCP_PORT="${PORT:-3000}"

# Render health checks and public traffic must pass the Host allowlist.
if [ -n "${RENDER_EXTERNAL_HOSTNAME:-}" ]; then
  case ",${MCP_ALLOWED_HOSTS:-localhost,127.0.0.1}," in
    *",${RENDER_EXTERNAL_HOSTNAME},"*) ;;
    *)
      export MCP_ALLOWED_HOSTS="${MCP_ALLOWED_HOSTS:-localhost,127.0.0.1},${RENDER_EXTERNAL_HOSTNAME}"
      ;;
  esac
fi

umask 077
mkdir -p secrets config
chmod 700 secrets

write_secret() { # $1=file $2=content; skip when content is empty
  if [ -n "${2:-}" ]; then
    printf '%s' "$2" > "$1"
    chmod 600 "$1"
  fi
}

: "${PROJECTS_CONFIG:=./config/projects.yaml}"
: "${MCP_AUTH_TOKEN_FILE:=./secrets/mcp-bearer.txt}"
: "${TOKEN_ENCRYPTION_KEY_FILE:=./secrets/token-key.txt}"

# projects.yaml is gitignored, so its full contents come from an env var.
# Credential paths inside it must point at the files written below, e.g.
# keyFile: ../secrets/service-account.json (relative to config/).
if [ -n "${RENDER_PROJECTS_YAML:-}" ]; then
  printf '%s' "$RENDER_PROJECTS_YAML" > "$PROJECTS_CONFIG"
  chmod 600 "$PROJECTS_CONFIG"
fi

write_secret "$MCP_AUTH_TOKEN_FILE" "${RENDER_MCP_BEARER_TOKEN:-}"
write_secret "$TOKEN_ENCRYPTION_KEY_FILE" "${RENDER_TOKEN_ENCRYPTION_KEY:-}"
write_secret "./secrets/service-account.json" "${RENDER_SERVICE_ACCOUNT_JSON:-}"
write_secret "./secrets/oauth-client.json" "${RENDER_OAUTH_CLIENT_JSON:-}"
write_secret "./secrets/google-token.enc" "${RENDER_GOOGLE_TOKEN_ENC:-}"

exec node "${MCP_ENTRYPOINT:-dist/packages/google-mcp/src/index.js}"
