# MCP client configuration

Build first (`npm ci && npm run build`) and complete the Google authorization described in the README. Replace `/ABS/google-marketing-mcp` with your repository's absolute path and use an absolute Node executable if a desktop client cannot find Node in PATH. MCP configuration contains only **file paths**, never Google refresh tokens or service-account keys.

## Claude Desktop, Claude Code and Cursor: stdio

Use this `mcpServers` object in Claude Desktop's MCP configuration, a Claude Code `.mcp.json`, or Cursor's `.cursor/mcp.json`. Local/user configuration is preferable to committing machine-specific paths.

```json
{
  "mcpServers": {
    "google-marketing": {
      "command": "node",
      "args": ["/ABS/google-marketing-mcp/dist/packages/google-mcp/src/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "PROJECTS_CONFIG": "/ABS/google-marketing-mcp/config/projects.yaml",
        "TOKEN_ENCRYPTION_KEY_FILE": "/ABS/google-marketing-mcp/secrets/token-key.txt"
      }
    }
  }
}
```

For independent servers, make two entries using `dist/packages/gsc-mcp/src/index.js` and `dist/packages/ga4-mcp/src/index.js`. They may share a YAML file; separate YAML files can limit each process's project inventory. Do not configure the combined and both independent servers simultaneously unless you want duplicate tools.

Claude Code CLI equivalent:

```sh
claude mcp add --transport stdio google-marketing \
  --env MCP_TRANSPORT=stdio \
  --env PROJECTS_CONFIG=/ABS/google-marketing-mcp/config/projects.yaml \
  --env TOKEN_ENCRYPTION_KEY_FILE=/ABS/google-marketing-mcp/secrets/token-key.txt \
  -- node /ABS/google-marketing-mcp/dist/packages/google-mcp/src/index.js
```

Reference: [Claude MCP configuration](https://code.claude.com/docs/en/mcp), [Cursor MCP](https://cursor.com/docs/mcp).

## Codex: stdio

Add to `~/.codex/config.toml` (or a trusted project's `.codex/config.toml`):

```toml
[mcp_servers.google_marketing]
command = "node"
args = ["/ABS/google-marketing-mcp/dist/packages/google-mcp/src/index.js"]
tool_timeout_sec = 75

[mcp_servers.google_marketing.env]
MCP_TRANSPORT = "stdio"
PROJECTS_CONFIG = "/ABS/google-marketing-mcp/config/projects.yaml"
TOKEN_ENCRYPTION_KEY_FILE = "/ABS/google-marketing-mcp/secrets/token-key.txt"
```

For HTTP with this server's static bearer mode:

```toml
[mcp_servers.google_marketing_remote]
url = "https://mcp.example.com/mcp"
bearer_token_env_var = "GOOGLE_MARKETING_MCP_TOKEN"
tool_timeout_sec = 75
```

Set `GOOGLE_MARKETING_MCP_TOKEN` in the **client process environment** from the MCP bearer secret through your secret manager. Do not set it to a Google token. For OAuth mode, omit `bearer_token_env_var` and use `codex mcp login google_marketing_remote` after configuring the authorization server. Official reference: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## VS Code

Example `.vscode/mcp.json` for local execution:

```json
{
  "servers": {
    "google-marketing": {
      "type": "stdio",
      "command": "node",
      "args": ["/ABS/google-marketing-mcp/dist/packages/google-mcp/src/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "PROJECTS_CONFIG": "/ABS/google-marketing-mcp/config/projects.yaml",
        "TOKEN_ENCRYPTION_KEY_FILE": "/ABS/google-marketing-mcp/secrets/token-key.txt"
      }
    }
  }
}
```

HTTP with a prompted MCP bearer secret:

```json
{
  "inputs": [
    {
      "id": "marketing-token",
      "type": "promptString",
      "description": "MCP bearer token",
      "password": true
    }
  ],
  "servers": {
    "google-marketing": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${input:marketing-token}" }
    }
  }
}
```

Agent Host and remote environments may have different support for interactive inputs; use OAuth or their supported secret store if prompting is unavailable. Reference: [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## Claude Code / Cursor: remote

Claude Code `.mcp.json` static-bearer example (environment expansion is performed by the client):

```json
{
  "mcpServers": {
    "google-marketing": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer ${GOOGLE_MARKETING_MCP_TOKEN}" }
    }
  }
}
```

Cursor uses an HTTP `url` entry and headers; use its supported environment/secret mechanism. For OAuth-enabled clients, configure the URL without a static Authorization header, then complete the client's login flow. The server's Google OAuth helper is a different flow run by the operator.

## ChatGPT

ChatGPT is a remote client; it cannot launch the local stdio process. Publish an HTTPS endpoint reachable from ChatGPT and select **OAuth mode** as described in [remote-oauth.md](remote-oauth.md). Add the MCP URL through the account/workspace's available custom MCP/app developer interface, configure OAuth credentials if required, and authorize with your external authorization server.

ChatGPT availability and organization policy are controlled by the account/workspace. Static arbitrary Authorization headers are not assumed to be configurable in its connector UI. This repository implements the OAuth **resource server**, not a login/consent service. You must supply a compatible authorization server with client registration/PKCE support. Never choose unauthenticated public access merely to make connection easier. Official reference: [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth).

## Generic MCP clients

- stdio: launch one compiled entrypoint with the environment above; stdin/stdout must remain exclusively MCP JSON-RPC. Configure `node` directly, not `npm start`, because npm may print banners to stdout.
- Streamable HTTP: connect to `/mcp`, send `Accept: application/json, text/event-stream` and JSON Content-Type, and use MCP initialization/version headers as specified by your SDK. Supply the configured static bearer token or a valid resource-scoped OAuth access token.
- No legacy `/sse` endpoint exists. The stateless transport may return JSON rather than SSE, and GET/DELETE are intentionally 405.
- First call `projects_list`; then query one small report. Tool listing is a protocol smoke test, not a credential test.

These configuration formats are documented examples, not a claim that every client UI has been manually tested. Automated tests exercise the official TypeScript SDK's stdio and Streamable HTTP clients.
