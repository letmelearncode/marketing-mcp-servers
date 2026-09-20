# Deploy to Google Cloud Run

Cloud Run runs the combined MCP server as a stateless HTTPS service. It starts a container only while requests are being handled (`min instances = 0`), so occasional MCP use is well suited to its request-based free tier. A first request after inactivity can take a few seconds while the container starts.

This deployment uses a dedicated **Cloud Run service identity** with Application Default Credentials (ADC). It is safer than uploading a downloadable Google service-account key: Cloud Run obtains short-lived Google credentials for the identity automatically.

## One-time Google Cloud setup

Choose one deployment project. It may be `astromitra`, `kiranax-ee026`, or a separate project dedicated to the MCP server. In the Google Cloud console:

1. Enable Cloud Run, Cloud Build, Secret Manager, Google Search Console API, Google Analytics Data API, and Google Analytics Admin API.
2. Create a service account, for example `google-marketing-mcp-runtime`, in the deployment project. Record its email address.
3. Add that exact email as a **Full user** on each configured Search Console property and a **Viewer** on each GA4 property.
4. For every `googleCloudProjectId` listed in the configuration, grant the runtime service account `roles/serviceusage.serviceUsageConsumer` in IAM. This allows Google API quota to be charged to the intended project.
5. Create a Google Cloud billing account, attach it to the deployment project, and create a small budget alert. Cloud Run requires billing even when usage remains within the free tier.

## Prepare local deployment inputs

Run these commands from the repository root:

```sh
cp config/cloud-run-projects.example.yaml config/cloud-run-projects.yaml
mkdir -p secrets
chmod 700 secrets
umask 077
openssl rand -hex 32 > secrets/mcp-bearer.txt
chmod 600 config/cloud-run-projects.yaml secrets/mcp-bearer.txt
```

Edit `config/cloud-run-projects.yaml` to retain only your real properties and project IDs. It must retain `type: adc`; do not include any `keyFile` or Google key JSON.

## Deploy

Install and authenticate the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), then run:

```sh
export GOOGLE_CLOUD_PROJECT=your-deployment-project-id
export CLOUD_RUN_SERVICE_ACCOUNT=google-marketing-mcp-runtime@your-deployment-project-id.iam.gserviceaccount.com
./scripts/deploy-cloud-run.sh
```

The script builds from source, creates or versions two Secret Manager secrets, grants only the runtime identity permission to read them, deploys Cloud Run, then pins the generated `run.app` hostname in the MCP host allowlist. It prints only the endpoint URL, never secret values.

Connect a static-bearer MCP client to:

```text
https://YOUR_CLOUD_RUN_URL/mcp
```

Send the bearer token from `secrets/mcp-bearer.txt` through the client’s secret mechanism. It is an MCP access token, not a Google credential.

## Validate and operate

```sh
gcloud run services describe google-marketing-mcp \
  --project "$GOOGLE_CLOUD_PROJECT" --region asia-south1 \
  --format='value(status.url)'
```

`/healthz` confirms the container is running. Then make one small authenticated `projects_list` MCP request followed by a small GA4 and GSC report. Tool discovery and health checks do not prove Google property access.

To rotate the bearer token, replace `secrets/mcp-bearer.txt` with a newly generated value and rerun the deploy script. To change project configuration, edit `config/cloud-run-projects.yaml` and rerun it. Each run creates a new Secret Manager version and a new Cloud Run revision.

Keep `min instances` at zero for low cost. Do not use periodic pings to keep it warm; accept the occasional cold start or set a minimum instance only when you deliberately want to pay for continuous availability.
