import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
export interface OAuthResourceOptions {
  issuer: string;
  resource: string;
  jwksUrl: string;
  scope: string;
}
export function validateOAuthOptions(options: OAuthResourceOptions) {
  for (const value of [options.issuer, options.resource, options.jwksUrl]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search)
      throw new Error(
        'OAuth issuer, resource and JWKS URLs must be HTTPS without credentials, queries or fragments.',
      );
  }
  if (new URL(options.resource).pathname !== '/mcp' || !/^[a-zA-Z0-9:._-]+$/.test(options.scope))
    throw new Error('OAuth resource must end in /mcp and scope must be a single valid scope.');
}
export function createJwtVerifier(options: OAuthResourceOptions, keySet?: JWTVerifyGetKey) {
  validateOAuthOptions(options);
  const keys =
    keySet ??
    createRemoteJWKSet(new URL(options.jwksUrl), {
      timeoutDuration: 5000,
      cooldownDuration: 30000,
    });
  return async (token: string): Promise<boolean> => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: options.issuer,
        audience: options.resource,
        algorithms: ['RS256', 'ES256'],
        requiredClaims: ['exp', 'iat', 'sub'],
        clockTolerance: 5,
      });
      return typeof payload.scope === 'string' && payload.scope.split(' ').includes(options.scope);
    } catch {
      return false;
    }
  };
}
