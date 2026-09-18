import { GoogleAuth, OAuth2Client, type AuthClient } from 'google-auth-library';
import { z } from 'zod';
import { type Config, type Mode, scopesFor } from './config.js';
import { decrypt, encryptionKey, readSecret } from './secrets.js';

const clientSchema = z.object({
  installed: z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) }),
});
export async function oauthClient(file: string, redirect?: string): Promise<OAuth2Client> {
  const { installed } = clientSchema.parse(JSON.parse(await readSecret(file)));
  return new OAuth2Client(installed.client_id, installed.client_secret, redirect);
}
export class AuthPool {
  private clients = new Map<string, Promise<AuthClient>>();
  constructor(
    private config: Config,
    private mode: Mode,
  ) {}
  get(profile: string): Promise<AuthClient> {
    let result = this.clients.get(profile);
    if (!result) {
      result = this.create(profile).catch(() => {
        this.clients.delete(profile);
        throw new Error('Google authentication failed. Check server credentials.');
      });
      this.clients.set(profile, result);
    }
    return result;
  }
  private async create(name: string): Promise<AuthClient> {
    const c = this.config.credentials[name];
    if (!c) throw new Error('Missing credential profile');
    const scopes = scopesFor(this.mode);
    if (c.type === 'oauth') {
      const client = await oauthClient(c.clientFile);
      const token = z
        .object({ refresh_token: z.string().min(1), scopes: z.array(z.string()) })
        .parse(decrypt(await readSecret(c.tokenFile), await encryptionKey()));
      if (!scopes.every((s) => token.scopes.includes(s)))
        throw new Error('Reauthorize with the required read-only scopes');
      client.setCredentials({ refresh_token: token.refresh_token });
      return client;
    }
    if (c.type === 'service_account') {
      const key = z
        .object({
          type: z.literal('service_account'),
          client_email: z.string().email(),
          private_key: z.string().min(1),
          project_id: z.string().optional(),
        })
        .parse(JSON.parse(await readSecret(c.keyFile)));
      return new GoogleAuth({ credentials: key, scopes }).getClient();
    }
    return new GoogleAuth({ scopes }).getClient();
  }
}
