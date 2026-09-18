import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lstat, readFile, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readSecret(file: string): Promise<string> {
  const stat = await lstat(file);
  if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0))
    throw new Error('Secret files must be regular files with owner-only permissions (chmod 600).');
  return readFile(file, 'utf8');
}
export async function encryptionKey(): Promise<Buffer> {
  const file = process.env.TOKEN_ENCRYPTION_KEY_FILE;
  if (!file) throw new Error('TOKEN_ENCRYPTION_KEY_FILE is required for OAuth.');
  const value = (await readSecret(file)).trim();
  if (!/^[a-fA-F0-9]{64}$/.test(value))
    throw new Error('Encryption key must be 32 bytes encoded as 64 hex characters.');
  return Buffer.from(value, 'hex');
}
export function encrypt(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}
export function decrypt(value: string, key: Buffer): unknown {
  const envelope = JSON.parse(value) as { version: number; iv: string; tag: string; data: string };
  if (envelope.version !== 1) throw new Error('Unsupported token format.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8'),
  );
}
export async function writeSecret(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
