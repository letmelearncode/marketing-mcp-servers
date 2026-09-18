# OAuth for remote MCP clients

There are two separate authorization relationships:

1. **Operator → Google**: the local Google OAuth helper obtains and encrypts a read-only refresh token. Google credentials stay inside the MCP server.
2. **MCP client → this server**: your OAuth authorization server authenticates people/clients and issues audience-bound access tokens. ChatGPT, Codex and other clients send those tokens to this server, never to Google.

The built-in bearer mode is convenient for trusted clients that accept custom headers. OAuth mode supports clients that discover and perform OAuth through an external authorization server. The repository is not an authorization server and does not implement user accounts, login pages, DCR, CIMD or token issuance.

## Configure an authorization server

Use your existing OAuth 2.1/OIDC provider or an MCP-compatible identity gateway. It must:

- Publish standard authorization-server discovery metadata with authorization/token endpoints and S256 PKCE support.
- Support authorization code + PKCE for your chosen client, with dynamic registration, Client ID Metadata Documents, or explicitly preregistered client credentials as required by that client.
- Register the exact callback URI shown by the MCP client. For ChatGPT, use the callback shown in its connector configuration; do not guess a callback path.
- Issue JWT **access tokens** signed with RS256 or ES256, with `iss` exactly equal to the configured issuer, `aud` containing your exact resource URL, `sub`, `iat`, `exp`, and a space-separated `scope` including `mcp:read`.
- Honor the OAuth `resource` parameter and restrict access to the operator-approved users/groups. Do not issue `mcp:read` indiscriminately to everyone in a public tenant.
- Publish its public signing keys at an HTTPS JWKS URL, rotating them with an overlap period. Opaque tokens and nonstandard scope claims are not supported by this implementation.

This resource server validates signatures, issuer, audience, expiry and the required scope. It requires `sub` and `iat` claims and applies a five-second clock tolerance. Access tokens can be reused until expiry; this is stateless JWT validation, not token introspection or immediate revocation. Use short access-token lifetimes and revoke client grants at the authorization server.

## Configure this server

Set in `.env` or your deployment environment:

```dotenv
MCP_TRANSPORT=http
MCP_AUTH_MODE=oauth
MCP_RESOURCE_URL=https://mcp.example.com/mcp
MCP_OAUTH_ISSUER=https://login.example.com/
MCP_OAUTH_JWKS_URL=https://login.example.com/.well-known/jwks.json
MCP_OAUTH_SCOPE=mcp:read
MCP_ALLOWED_HOSTS=mcp.example.com,127.0.0.1,localhost
```

Replace all example URLs. The `MCP_AUTH_TOKEN_FILE` setting is ignored in OAuth mode; there is no static-token fallback. Keep all issuer/JWKS/resource settings under operator control. Resource URLs must use HTTPS and end in `/mcp`; queries, fragments and embedded credentials are forbidden.

Route HTTPS `/mcp` and `/.well-known/oauth-protected-resource/mcp` to this server without altering their paths. Forward the original Host. Your TLS proxy must not log Authorization headers or request bodies. Browser origins, when present, must match `MCP_ALLOWED_ORIGINS`. Native/server clients normally omit Origin. CORS browser embedding is not enabled; use a deliberately configured gateway for browser clients.

Unauthenticated `/mcp` returns a 401 with a `WWW-Authenticate` challenge pointing to the metadata URL. Public metadata describes the resource, authorization server and scope:

```json
{
  "resource": "https://mcp.example.com/mcp",
  "authorization_servers": ["https://login.example.com/"],
  "scopes_supported": ["mcp:read"],
  "bearer_methods_supported": ["header"]
}
```

The client discovers your external authorization server, performs its login flow, and returns to `/mcp` with its access token. Google access tokens, ID tokens for other audiences, and expired/unsigned JWTs are rejected. Enable NTP on the server.

## Trust boundary

All accepted access tokens authorize every project loaded in this instance. This is suitable for a single operator or trusted team. It is **not** a per-user Google-account connector and does not map `sub` to separate project permissions. Deploy separate instances with different configurations, OAuth audiences and Google identities for separate trust groups. The same caution applies to static bearer tokens.

For split GSC/GA4 deployment with distinct public hostnames, assign a distinct resource/audience to each service using a Compose override or separate deployments. Do not expose both instances under the same audience when they represent different trust groups.

References: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [ChatGPT authentication requirements](https://developers.openai.com/plugins/build/auth).
