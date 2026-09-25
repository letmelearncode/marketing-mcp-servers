# Google Marketing MCP

Self-hosted, read-only Google Search Console and Google Analytics 4 tools for MCP clients. One TypeScript repository provides three runnable servers: `gsc-mcp`, `ga4-mcp`, and a combined `google-marketing-mcp`. No project IDs or Google credentials are hard-coded.

- Local **stdio** for Claude Desktop/Code, Codex, Cursor, VS Code and generic MCP clients.
- Remote **Streamable HTTP** at `/mcp`: static bearer authentication or OAuth JWT resource-server authentication for an external authorization server, including OAuth-based ChatGPT connections.
- Named projects, per-project credential profiles, encrypted Google refresh tokens, ADC/workload identity and service accounts.
- Fifteen read-only tools, bounded requests, explicit pagination and sanitized upstream errors.

## Requirements

Node 22.13+ or 24+ is recommended (`.nvmrc` selects 22). The code/toolchain also accepts Node 20.19+, but use a supported LTS release for production. npm, Google Cloud access, and permission to the GSC/GA4 properties are required. Docker is optional.

## Quick start

Run these commands from the repository root:

```sh
npm ci
npm run check
cp config/projects.example.yaml config/projects.yaml
cp .env.example .env
mkdir -p secrets
chmod 700 secrets
umask 077
openssl rand -hex 32 > secrets/token-key.txt
openssl rand -hex 32 > secrets/mcp-bearer.txt
```

Run key-generation commands once; replacing `token-key.txt` makes existing encrypted tokens unreadable. Never put these files in source control. Complete the Google setup below, download your **Desktop app** OAuth client JSON to `secrets/oauth-client.json`, then:

```sh
chmod 600 secrets/*
# Edit config/projects.yaml: replace example IDs and remove unused projects.
node --env-file=.env dist/packages/core/src/oauth-setup.js default combined
node --env-file=.env dist/packages/google-mcp/src/index.js
```

The OAuth command prints an authorization URL, never an authorization code or token. Open it on the same machine, sign in, and grant the read-only scopes. The callback listens temporarily on loopback with a random port, state validation and PKCE. The encrypted refresh token is written to the configured file. For a headless server, authorize on a trusted workstation, then securely transfer the client JSON, encrypted token and key separately to the server. Do not expose the callback publicly.

The final command waits for MCP messages on stdin; this is expected. Normally your MCP client launches it. `.env` is **not auto-loaded** by npm scripts or the application; use Node's `--env-file` option, set environment variables explicitly, or configure them in your MCP client.

### Run independently

```sh
# Authorize just the scopes required by the selected server/profile:
node --env-file=.env dist/packages/core/src/oauth-setup.js default gsc
node --env-file=.env dist/packages/gsc-mcp/src/index.js

# Use a different credential profile/token file if you need isolated grants:
node --env-file=.env dist/packages/core/src/oauth-setup.js default ga4
node --env-file=.env dist/packages/ga4-mcp/src/index.js
```

Reauthorizing a profile replaces its token. If one OAuth profile is shared by both servers, authorize it with `combined`; independent processes still expose only their own tools. For strict scope isolation, configure separate OAuth clients/profiles and token files. Google may retain previously granted scopes for an identity/client: use separate clients or revoke old consent before reducing grants.

### Remote HTTP

```sh
MCP_TRANSPORT=http node --env-file=.env dist/packages/google-mcp/src/index.js
```

Connect to `http://127.0.0.1:3000/mcp` with `Authorization: Bearer <contents of secrets/mcp-bearer.txt>`. Use HTTPS through a reverse proxy for remote connections. The MCP bearer token is separate from Google credentials. See [client examples](docs/clients.md) and [OAuth remote access](docs/remote-oauth.md).

## Google Cloud and property setup

1. Create/select a Google Cloud project. Record its **project ID**, not its numeric project number. Enable the **Google Search Console API**, **Google Analytics Data API**, and **Google Analytics Admin API** (Admin is needed for discovery/property details). Enable the APIs in every configured quota project as appropriate.
2. Configure Google Auth Platform branding, audience and data access. Choose Internal only for an eligible Workspace organization; otherwise External. During testing, add your Google account as a test user.
3. Create an OAuth client with application type **Desktop app**. Download its JSON. This repository deliberately accepts the `installed` client format; a Web application JSON is not interchangeable with this loopback flow.
4. Request only these scopes (the helper selects them by server mode):
   - GSC: `https://www.googleapis.com/auth/webmasters.readonly`
   - GA4: `https://www.googleapis.com/auth/analytics.readonly`
5. The consenting user must have access in **Search Console → Settings → Users and permissions** and/or **Analytics → Admin → Property access management**. Start with the lowest suitable access; GA4 Viewer is sufficient for reports. URL Inspection may need stronger property permissions than basic reporting. OAuth scopes still remain read-only.
6. Copy the exact GSC property identifier (`sc-domain:example.com` or `https://www.example.com/`) and the numeric **GA4 property ID**. A GA4 measurement ID beginning `G-` is not a property ID.
7. This server sends `x-goog-user-project` using each named project's `googleCloudProjectId`. The calling principal needs `serviceusage.services.use` on that Cloud project, normally via **Service Usage Consumer** (`roles/serviceusage.serviceUsageConsumer`). Cloud IAM does not grant GSC/GA4 property access.
8. Run the OAuth helper. External apps in Testing can receive refresh tokens with short lifetimes (commonly seven days for these scopes); production use may require publishing and Google's verification depending on audience and scope policy. Plan for reauthorization and revocation.

Google references: [Desktop OAuth/PKCE](https://developers.google.com/identity/protocols/oauth2/native-app), [GA4 API quickstart](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart), [Search Console authorization](https://developers.google.com/webmaster-tools/v1/how-tos/authorizing).

### ADC / workload identity

Set a credential profile to `type: adc`. On Google Cloud, attach a dedicated service account and use Application Default Credentials; outside Google Cloud, configure supported workload identity federation and `GOOGLE_APPLICATION_CREDENTIALS` on the **server**, not in prompts. Grant its identity property access separately. No long-lived service-account key is needed in workload identity deployments.

For explicit service-account keys, configure `type: service_account` and `keyFile`; the JSON must have `type: service_account` and mode `0600`. Add the service-account email to each GSC/GA4 property. Avoid Owner/Editor Cloud roles. ADC files are managed by Google's library and are not encrypted by this repository. The server cannot narrow scopes already granted to ADC user credentials; provision appropriate read-only credentials and OS permissions.

## Project configuration

```yaml
credentials:
  reporting:
    type: oauth
    clientFile: ../secrets/oauth-client.json
    tokenFile: ../secrets/google-token.enc
projects:
  shop:
    googleCloudProjectId: my-cloud-project
    credential: reporting
    discovery: false
    searchConsole:
      siteUrl: sc-domain:example.com
    analytics:
      propertyId: '123456789'
```

Paths in YAML resolve relative to the YAML file. Environment variable file paths resolve relative to the process working directory; absolute paths are recommended for clients. Configuration is validated once at startup; restart after edits.

Every tool takes a named `project`. Report tools use only that project's configured property. Model requests cannot substitute arbitrary GA4 property IDs, Google hosts or credential files. Discovery is disabled by default; `discovery: true` intentionally permits listings of **all properties visible to that credential**, potentially beyond configured projects. Configure a restricted Google identity if that exposure is inappropriate.

A server instance is a **single trust boundary**: every authenticated client can access all projects loaded by that instance. Named configurations are routing, not per-user tenancy. Run separate instances/configuration files and separate credentials for different users or trust groups.

## Tools

| Tool                                        | Purpose                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `projects_list`                             | Safe project inventory (no credential details)                                          |
| `gsc_sites_list` / `gsc_site_get`           | Discovery / configured site permissions                                                 |
| `gsc_search_analytics`                      | Dates, dimensions, filters, search type, aggregation, fresh/hourly data, row pagination |
| `gsc_sitemaps_list` / `gsc_sitemap_get`     | Submitted sitemap listing / details                                                     |
| `gsc_url_inspect`                           | Google's indexed URL status, confined to the configured property                        |
| `ga4_accounts_list` / `ga4_properties_list` | Account summaries / properties with page tokens                                         |
| `ga4_property_get`                          | Configured property details                                                             |
| `ga4_metadata`                              | Available core dimensions/metrics, including custom definitions                         |
| `ga4_check_compatibility`                   | Validate report combinations with Google                                                |
| `ga4_run_report`                            | Core reports, filters, sorting, dates, offset pagination, quota info                    |
| `ga4_batch_reports`                         | Up to five core reports for one configured property                                     |
| `ga4_realtime`                              | Realtime dimensions/metrics and minute ranges                                           |

All tools carry MCP read-only annotations. There are no property mutations, sitemap submissions, analytics writes or indexing requests.

### Report examples

`gsc_search_analytics`:

```json
{
  "project": "shop",
  "startDate": "2026-08-01",
  "endDate": "2026-08-31",
  "dimensions": ["query", "page"],
  "dimensionFilterGroups": [
    {
      "groupType": "and",
      "filters": [{ "dimension": "country", "operator": "equals", "expression": "ind" }]
    }
  ],
  "rowLimit": 1000,
  "startRow": 0
}
```

`ga4_run_report`:

```json
{
  "project": "shop",
  "dateRanges": [{ "startDate": "30daysAgo", "endDate": "yesterday" }],
  "dimensions": [{ "name": "sessionSource" }, { "name": "landingPage" }],
  "metrics": [{ "name": "sessions" }, { "name": "keyEvents" }],
  "dimensionFilter": {
    "filter": { "fieldName": "country", "stringFilter": { "matchType": "EXACT", "value": "India" } }
  },
  "orderBys": [{ "metric": { "metricName": "sessions" }, "desc": true }],
  "limit": 1000,
  "offset": 0
}
```

GA4 filter expressions support `andGroup`, `orGroup`, `notExpression` (up to three nesting levels), string, in-list, numeric, between and empty filters. Inputs follow Google's camelCase JSON, except `limit`/`offset` are safe integer numbers and are converted to API int64 strings. Unknown keys are rejected. Use metadata and compatibility before inventing field names. Pivot/cohort/funnel reports are outside this version's scope.

### Pagination and interpretation

GSC responses wrap the Google result in `data` and return `pagination.nextStartRow`; keep all query parameters constant while advancing. `null` means the page was shorter than the requested limit, not that all underlying search data was available. The API returns top rows, omits some anonymized queries, and can have unstable ordering for ties. Maximum page size is 25,000. Dates use Pacific time; fresh/hourly results can be partial. See [Google's query contract](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).

GA4 core results return `data` plus `pagination.nextOffset`. Use `rowCount` and a stable `orderBys` to page through changing datasets; maximum page size is 250,000, but small pages are better for model context. Responses above 4 MiB are rejected; reduce page size. Batch responses retain Google's `reports[]` shape with per-report `rowCount`. Discovery retains Google's `nextPageToken`. Realtime has no offset pagination and uses a separate field schema; this implementation supports the standard 30-minute window (not the extended Analytics 360 window). See [core reports](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport) and [realtime](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runRealtimeReport).

Keep Google's response metadata, quotas, thresholding and sampling indicators when interpreting results. GA4 sessions and GSC clicks measure different events and use different attribution/timezone rules; they need not match. This server does not automatically download all pages or bypass quotas.

## Docker

Authorize Google on the host first. The example YAML's `../secrets/...` paths also resolve correctly inside the image. Only source/build dependencies are copied; secrets and local configuration are excluded by `.dockerignore`.

```sh
# Match the owner of the 0600 mounted secret files (Linux/macOS shell):
export MCP_UID=$(id -u)
export MCP_GID=$(id -g)
docker compose --profile combined up --build -d
# Or independently on localhost ports 3001 and 3002:
docker compose --profile split up --build -d
```

Do not run as UID 0. If your deployment uses UID 1000, provision secret files readable by that UID with mode `0600`. Do not loosen them to world-readable. Secrets/config are mounted read-only; authorize or rotate on the host and restart containers. Restart after atomically replacing a mounted secret file. Compose publishes only loopback ports. Put an HTTPS reverse proxy on the host or a private container network, forward `Host` unchanged, and add the public hostname to `MCP_ALLOWED_HOSTS` **alongside `127.0.0.1` for health checks**. Keep `/mcp` and, for OAuth mode, the metadata path unchanged. Allow up to 70 seconds for API requests.

The image runs unprivileged with a read-only filesystem, no Linux capabilities, bounded memory/PIDs, and a liveness check. `/healthz` means the process is alive; it does not test Google permissions. Stateless HTTP uses POST requests with JSON responses; GET/DELETE return 405. It supports no sessions, resumable SSE, unsolicited notifications or legacy SSE endpoint.

## Deploy

Production runs on **Google Cloud Run** (project `kognitilabs`, region `asia-south1`, scale-to-zero) using the Cloud Run service identity with ADC — no downloadable keys. See [Cloud Run deployment](docs/cloud-run.md) for setup, the deploy script, and operations.

A `render.yaml` Blueprint for Render's native Node runtime is also provided (`scripts/render-start.sh` rebuilds config/secrets from env vars), but that path is currently on hold: see [Render deployment](docs/render.md).

## Deploy to Google Cloud Run

Cloud Run is recommended for occasional remote MCP use: it scales to zero when idle and provides a managed HTTPS endpoint. The Cloud Run deployment uses a dedicated runtime service identity with short-lived ADC credentials, so no Google service-account key is stored or uploaded. See [Cloud Run deployment](docs/cloud-run.md).

## Architecture and development

```text
packages/core/src/         config, credentials, OAuth bootstrap, Google API client,
                           MCP registration, HTTP/JWT authentication, transports
packages/gsc-mcp/src/      GSC tool definitions and independent entrypoint
packages/ga4-mcp/src/      GA4 schemas/tools and independent entrypoint
packages/google-mcp/src/   combined entrypoint
config/                   reusable configuration examples
tests/                    schema, credential, routing, JWT, stdio and HTTP tests
docs/                     client setup, remote OAuth, security and operations
```

One root package/lockfile builds all entrypoints into `dist/packages/...`. These are logical source packages, not independently published npm packages. The stable MCP TypeScript SDK is pinned to 1.30.0. `google-auth-library` supplies credential refresh and authenticated HTTP requests. API URLs are fixed, validated Google endpoints. Only read-only operations are retried (including read-only POST reports): at most two retries on quota/server errors with the library's backoff, 30-second request timeout, 60-second retry budget. No credentials are logged; raw Google error objects are never serialized.

```sh
npm run lint
npm run typecheck
npm test          # builds first; tests use fake Google responses, no credentials
npm run build
npm run check     # all checks
npm audit
```

Tests exercise actual MCP SDK clients and both transports, separate entrypoints, routing, schema rejection, encryption/tampering, scope checks, and HTTP/JWT authentication. Google payloads are mocked; a real credential/property smoke test is still required before deployment. CI also builds the Docker image and checks Compose.

## Example prompts

- “List configured projects. For shop, show the top 20 queries and landing pages last month; distinguish complete from fresh GSC data.”
- “For shop, compare organic sessions and key events over the last two complete 30-day periods. Check GA4 field compatibility first.”
- “List submitted sitemaps for shop and inspect the indexed status of https://example.com/products/widget.”
- “Show active users by country right now. Use realtime-supported fields.”
- “Compare shop and another configured project separately. Preserve each property's timezone and quota information.”

## Troubleshooting

| Symptom                           | Check                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Startup failure                   | Valid YAML, quoted property IDs, existing credential profile, absolute paths and secret permissions |
| Google 403                        | Enabled APIs, property membership, read-only scopes, Service Usage Consumer on quota project        |
| Google 401 / revoked consent      | Rerun OAuth helper; check consent app testing status                                                |
| MCP 401                           | Correct MCP bearer token, or OAuth audience/issuer/expiry/scope; not a Google access token          |
| MCP 403                           | Host/origin allowlists and reverse proxy's forwarded Host                                           |
| Quota exhaustion                  | Wait, reduce report complexity/frequency, inspect returned property quota                           |
| Empty report                      | Correct property, dates/timezone, filters, processing delay and privacy thresholds                  |
| Tools list works but report fails | Credentials are initialized lazily; tool discovery does not prove Google access                     |
| Docker secret permission error    | File mode 0600, directory 0700, container UID/GID match owner                                       |

See [security guidance](docs/security.md), [clients](docs/clients.md), and [remote OAuth](docs/remote-oauth.md).
