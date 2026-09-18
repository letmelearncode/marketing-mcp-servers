# Security and operations

## Secrets

Google refresh tokens are stored with AES-256-GCM authenticated encryption, unique random nonces, atomic writes and mode 0600. The encryption key is supplied through a separate file. Access tokens remain in process memory and are refreshed by `google-auth-library`; no access-token files are written. Client secrets and service-account key files are read only from operator-configured files.

Keep the key and encrypted token in different secret-manager entries. Encryption does not protect against an attacker who can read both or execute code as the server user. File paths and YAML are operator-controlled, never model-controlled. Direct secret files must be regular, non-symlink files with owner-only permissions on POSIX; mount Kubernetes/other secret-manager projections accordingly (copy into private regular files if the manager uses symlinks). On Windows, use restrictive ACLs; POSIX mode checks are unavailable.

The Google OAuth client JSON and service-account keys are not additionally encrypted by this repository; protect them using encrypted disks/secret stores and OS permissions. ADC external credential configuration is trusted server-side input and should come from your deployment administrator, never a tool call. For keyless service accounts, prefer workload identity. Scope choice cannot reduce a previously broad OAuth/ADC grant; provision dedicated identities and clients.

## Network boundary

- HTTP binds to loopback by default. Use authenticated HTTPS for any remote connection. Container loopback publishing is deliberate.
- Requests must pass a Host allowlist; Origin, when present, must pass an exact allowlist. Proxy headers are not trusted. Configure public Host explicitly and retain loopback for health checks.
- Static bearer comparison uses constant-time hashes. OAuth mode verifies signed JWTs and is mutually exclusive with static bearer auth.
- Google API URLs are fixed, HTTPS and allowlisted. Redirects are disabled. Tool parameters cannot change the target host.
- HTTP JSON bodies are capped at 256 KiB, tool responses at 4 MiB, concurrent tool HTTP requests at 20, and `/mcp` traffic at 120 requests/minute/IP/process. Larger reports must be paginated.
- The IP limiter deliberately treats a reverse proxy as one source rather than trusting spoofable forwarded headers. Enforce user/IP limits at your trusted gateway for larger deployments. Limits are process-local, not distributed.
- Configure reverse-proxy connection/body/time limits and restrict network reachability. No CORS headers or browser embedding support are provided by default.

## Permissions and data exposure

All implemented Google operations are read-only, including report and inspection POSTs. Google credentials never go to MCP clients. Report data **does** go to the model/client and can contain sensitive search queries, URLs and analytics dimensions; use appropriate Google property access and your organization's model-data policies.

Every authenticated client can read every configured project in an instance. Separate instances for separate tenants/users. Discovery is an explicit opt-in because the Google identity may see properties beyond the configured list. Metadata and health endpoints contain no credentials; they are intentionally public behind the Host allowlist.

Read-only MCP hints are descriptive, not authorization. Enforcement comes from fixed API operations, schema validation, project binding, Google scopes and HTTP authentication. Treat returned query strings/URLs as untrusted data when asking a model to summarize them.

## Logging and failures

Stdout is reserved for MCP in stdio mode. Stderr contains only short startup/shutdown/OAuth instructions; no request payloads, authorization codes, access tokens, refresh tokens, credential JSON or raw Google exceptions are logged. The OAuth browser URL necessarily includes a public client ID and temporary state/PKCE challenge, but no code or token. Never enable third-party verbose HTTP debugging with production credentials.

Upstream errors are mapped to safe categories; raw responses/headers are never attached. This intentionally trades detailed diagnostics for avoiding secret leakage. Troubleshoot API enablement and permissions in the Google console. Monitor status/latency at a proxy with header/body logging disabled. A successful `/healthz` is liveness only; perform an operator-controlled small report to verify Google access.

## Rotation and recovery

- **MCP bearer**: generate a new random 32-byte value into a temporary private file, replace `mcp-bearer.txt`, restart the server, then update clients. The previous token stops working after restart.
- **Google refresh token**: rerun the OAuth helper on a trusted machine, securely transfer the new encrypted file and restart. Revoke old consent if compromise is suspected; consent revocation may invalidate all grants for that identity/client.
- **Encryption key**: preserve the old key until reauthorization and deployment succeed. Generate a new key and rerun OAuth, then atomically deploy the new key/token pair and restart. Do not simply replace the key under an existing encrypted token.
- **JWT signing keys**: rotate at the identity provider with key overlap; JWKS are cached. Use short token lifetimes. This implementation does not provide an immediate per-token denylist.
- Back up encrypted tokens and key separately. Loss of either requires reauthorization. Never commit live `.env`, `secrets/` or `config/projects.yaml`.

## Release checks

Run `npm ci`, `npm run check`, `npm audit`, and `docker build` in your release pipeline. Pin deployment images by digest after your own image scan. Keep Node and the lockfile updated. Before production, verify one small GSC and GA4 report using real test properties, confirm unauthorized HTTP requests fail, test your exact client's OAuth flow, and verify logs do not collect secrets.

Automated tests do not call live Google services or a deployed identity provider. They verify protocol behavior, mappings, local validation, encrypted credential handling and JWT claims. See `VALIDATION.md` for this build's observed checks and limitations.
