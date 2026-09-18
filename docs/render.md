# Deploy to Render

Deploys the combined server as a Render web service (native Node runtime) using the `render.yaml` Blueprint in the repo root. The entrypoint `scripts/render-start.sh` materializes the gitignored `config/projects.yaml` and `secrets/` files from environment variables at every boot, maps Render's `$PORT`, binds `0.0.0.0`, and appends the public hostname to `MCP_ALLOWED_HOSTS`.

## Prerequisites

Use a **service-account** credential profile. The interactive OAuth helper needs a loopback browser and cannot run on Render.

1. In Google Cloud Console, create a service account in your quota project and export a JSON key. Grant it:
   - **Service Usage Consumer** on the quota project (for `x-goog-user-project`),
   - Search Console property access (Settings → Users and permissions),
   - GA4 property access (Admin → Property access management; Viewer suffices).
2. Enable the Search Console API, Analytics Data API, and Analytics Admin API in the quota project.
3. Generate the static MCP bearer token (this protects your server; it is not a Google token):
   ```sh
   openssl rand -hex 32
   ```

## Deploy

1. Push this repo to GitHub (includes `render.yaml`).
2. Render Dashboard → New → Blueprint → select the repo. On first sync Render prompts for the `sync: false` secrets:
   - `RENDER_MCP_BEARER_TOKEN` — token from step 3 above.
   - `RENDER_SERVICE_ACCOUNT_JSON` — entire contents of the service-account key JSON.
   - `RENDER_PROJECTS_YAML` — full `projects.yaml`, e.g.:
     ```yaml
     credentials:
       reporting:
         type: service_account
         keyFile: ../secrets/service-account.json
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
     Keep `keyFile: ../secrets/service-account.json` exactly; the boot script writes the uploaded JSON there. Use the numeric GA4 property ID, not the `G-` measurement ID.
   - `RENDER_TOKEN_ENCRYPTION_KEY`, `RENDER_OAUTH_CLIENT_JSON`, `RENDER_GOOGLE_TOKEN_ENC` — only for `type: oauth` profiles. Authorize locally with `oauth-setup`, then paste the key, Desktop-app client JSON, and encrypted token.
3. Deploy, then verify `https://<service>.onrender.com/healthz` returns `{"status":"ok"}`.
4. Connect MCP clients to `https://<service>.onrender.com/mcp` with `Authorization: Bearer <mcp-bearer-token>`. First call `projects_list`, then one small report.

## Notes

- The `free` plan sleeps when idle (cold starts fit inside the 75s client timeout); use `starter` or higher for always-on.
- Secrets are re-materialized from env vars on every boot with `0600` permissions; to rotate, update the env var in Render and redeploy/restart. Never commit live secrets — `secrets/` and `config/projects.yaml` are gitignored.
- OAuth-mode remote clients (ChatGPT) still need an external authorization server per [remote-oauth.md](remote-oauth.md); set `MCP_AUTH_MODE=oauth` plus the `MCP_OAUTH_*` vars via a Render env-group or dashboard override.
