import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Account,
  AccountQuota,
  AccountStatus,
  ByokKey,
  ByokProvider,
  NativeProvider,
} from '@azuron/contract';
import type { AzuronPaths } from './paths.js';

export class AzuronAccountVault {
  private readonly db: DatabaseSync;
  private readonly paths: AzuronPaths;
  private readonly masterKey: Buffer;

  constructor(db: DatabaseSync, paths: AzuronPaths) {
    this.db = db;
    this.paths = paths;
    this.masterKey = this.loadOrCreateMasterKey();
  }

  private loadOrCreateMasterKey(): Buffer {
    fs.mkdirSync(path.dirname(this.paths.masterKeyPath), { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.paths.masterKeyPath)) {
      const hex = fs.readFileSync(this.paths.masterKeyPath, 'utf8').trim();
      const buf = Buffer.from(hex, 'hex');
      if (buf.length === 32) {
        return buf;
      }
    }
    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.paths.masterKeyPath, key.toString('hex'), { mode: 0o600 });
    return key;
  }

  public encryptSecret(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  public decryptSecret(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split(':');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Malformed encrypted payload');
    }
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.masterKey,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  public listAccounts(provider?: NativeProvider): Account[] {
    const rows = (
      provider
        ? this.db
            .prepare('SELECT * FROM accounts WHERE provider = ? ORDER BY is_active DESC, created_at ASC')
            .all(provider)
        : this.db
            .prepare('SELECT * FROM accounts ORDER BY provider ASC, is_active DESC, created_at ASC')
            .all()
    ) as Array<{
      id: string;
      provider: NativeProvider;
      account_name: string;
      auth_profile_path: string | null;
      is_active: number;
      status: AccountStatus;
      token_usage_cached: string | null;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      accountName: row.account_name,
      authProfilePath: row.auth_profile_path,
      isActive: row.is_active === 1,
      status: row.status,
      quota: row.token_usage_cached ? (JSON.parse(row.token_usage_cached) as AccountQuota) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public createAccount(provider: NativeProvider, accountName: string): Account {
    const id = `${provider}_${crypto.randomUUID().slice(0, 8)}`;
    const profileDir = path.join(this.paths.profilesDir, provider, id);
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });

    const existingForProvider = this.listAccounts(provider);
    const isActive = existingForProvider.length === 0 ? 1 : 0;
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO accounts (id, provider, account_name, auth_profile_path, encrypted_credentials, is_active, status, token_usage_cached, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, 'unverified', NULL, ?, ?)`,
      )
      .run(id, provider, accountName.trim(), profileDir, isActive, now, now);

    return this.getAccount(id)!;
  }

  public getAccount(id: string): Account | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
      | {
          id: string;
          provider: NativeProvider;
          account_name: string;
          auth_profile_path: string | null;
          is_active: number;
          status: AccountStatus;
          token_usage_cached: string | null;
          created_at: number;
          updated_at: number;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      provider: row.provider,
      accountName: row.account_name,
      authProfilePath: row.auth_profile_path,
      isActive: row.is_active === 1,
      status: row.status,
      quota: row.token_usage_cached ? (JSON.parse(row.token_usage_cached) as AccountQuota) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public activateAccount(id: string): Account {
    const target = this.getAccount(id);
    if (!target) {
      throw new Error(`Account not found: ${id}`);
    }
    const now = Date.now();
    this.db.prepare('UPDATE accounts SET is_active = 0, updated_at = ? WHERE provider = ?').run(now, target.provider);
    this.db.prepare('UPDATE accounts SET is_active = 1, updated_at = ? WHERE id = ?').run(now, id);
    return this.getAccount(id)!;
  }

  public updateAccountStatus(id: string, status: AccountStatus, quota?: AccountQuota | null): void {
    const now = Date.now();
    this.db
      .prepare('UPDATE accounts SET status = ?, token_usage_cached = COALESCE(?, token_usage_cached), updated_at = ? WHERE id = ?')
      .run(status, quota ? JSON.stringify(quota) : null, now, id);
  }

  public deleteAccount(id: string): boolean {
    const account = this.getAccount(id);
    if (!account) return false;
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    if (account.authProfilePath && fs.existsSync(account.authProfilePath)) {
      fs.rmSync(account.authProfilePath, { recursive: true, force: true });
    }
    // Promote next remaining account if active account was removed
    if (account.isActive) {
      const remaining = this.listAccounts(account.provider);
      if (remaining[0]) {
        this.activateAccount(remaining[0].id);
      }
    }
    return true;
  }

  public getNextFallbackAccount(provider: NativeProvider, excludeAccountId: string): Account | null {
    const candidates = this.listAccounts(provider).filter(
      (acc) => acc.id !== excludeAccountId && acc.status !== 'quota_exhausted' && acc.status !== 'expired',
    );
    return candidates[0] ?? null;
  }

  public listByokKeys(): ByokKey[] {
    const rows = this.db
      .prepare('SELECT id, provider, label, masked_key, status, created_at, updated_at FROM byok_keys ORDER BY created_at DESC')
      .all() as Array<{
      id: string;
      provider: ByokProvider;
      label: string;
      masked_key: string;
      status: ByokKey['status'];
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      label: r.label,
      maskedKey: r.masked_key,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public addByokKey(provider: ByokProvider, label: string, rawApiKey: string): ByokKey {
    const id = `byok_${provider}_${crypto.randomUUID().slice(0, 8)}`;
    const trimmed = rawApiKey.trim();
    const masked =
      trimmed.length <= 8
        ? '****'
        : `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
    const encrypted = this.encryptSecret(trimmed);
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO byok_keys (id, provider, label, masked_key, encrypted_api_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(id, provider, label.trim(), masked, encrypted, now, now);

    return {
      id,
      provider,
      label: label.trim(),
      maskedKey: masked,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
  }

  public getDecryptedByokKey(id: string): string | null {
    const row = this.db
      .prepare('SELECT encrypted_api_key FROM byok_keys WHERE id = ?')
      .get(id) as { encrypted_api_key: string } | undefined;
    if (!row) return null;
    return this.decryptSecret(row.encrypted_api_key);
  }

  public deleteByokKey(id: string): boolean {
    const res = this.db.prepare('DELETE FROM byok_keys WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  public saveIntegrationToken(
    name: 'github' | 'vercel' | 'rclone',
    rawToken: string,
    accountLabel?: string,
    details?: string,
  ): void {
    const encrypted = this.encryptSecret(rawToken.trim());
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO integrations (name, encrypted_token, account_label, details, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           encrypted_token = excluded.encrypted_token,
           account_label = COALESCE(excluded.account_label, integrations.account_label),
           details = COALESCE(excluded.details, integrations.details),
           updated_at = excluded.updated_at`,
      )
      .run(name, encrypted, accountLabel ?? null, details ?? null, now);
  }

  public getIntegrationToken(name: 'github' | 'vercel' | 'rclone'): {
    token: string | null;
    accountLabel: string | null;
    details: string | null;
    updatedAt: number | null;
  } {
    const row = this.db
      .prepare('SELECT encrypted_token, account_label, details, updated_at FROM integrations WHERE name = ?')
      .get(name) as
      | {
          encrypted_token: string | null;
          account_label: string | null;
          details: string | null;
          updated_at: number;
        }
      | undefined;

    if (!row) {
      return { token: null, accountLabel: null, details: null, updatedAt: null };
    }
    return {
      token: row.encrypted_token ? this.decryptSecret(row.encrypted_token) : null,
      accountLabel: row.account_label,
      details: row.details,
      updatedAt: row.updated_at,
    };
  }
}
