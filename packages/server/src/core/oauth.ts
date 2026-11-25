import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Account } from '@azuron/contract';
import type { AzuronStreamHub } from './stream-hub.js';
import type { AzuronAccountVault } from './vault.js';

export interface OAuthLaunchResult {
  ok: boolean;
  accountId: string;
  provider: Account['provider'];
  profilePath: string;
  command: string;
  oauthUrl: string | null;
  cliAvailable: boolean;
  email: string | null;
  message: string;
}

const URL_REGEX = /https:\/\/[^\s"'<>]+/i;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function resolveProviderBinary(provider: Account['provider']): { bin: string; resolvedPath: string | null; args: string[] } {
  const bin =
    provider === 'codex'
      ? process.env.AZURON_CODEX_BIN || 'codex'
      : process.env.AZURON_AGY_BIN || 'agy';
  const args = provider === 'codex' ? ['login'] : ['auth', 'login'];

  if (path.isAbsolute(bin)) {
    return { bin, resolvedPath: fs.existsSync(bin) ? bin : null, args };
  }
  const probe = spawnSync('which', [bin], { encoding: 'utf8' });
  const found = probe.status === 0 ? probe.stdout.trim().split('\n')[0] || null : null;
  return { bin, resolvedPath: found, args };
}

function extractEmailFromJwt(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof payload.email === 'string' && EMAIL_REGEX.test(payload.email)) {
      return payload.email;
    }
    const profile = payload['https://api.openai.com/profile'] as Record<string, unknown> | undefined;
    if (profile && typeof profile.email === 'string' && EMAIL_REGEX.test(profile.email)) {
      return profile.email;
    }
  } catch {
    // Ignore malformed JWT
  }
  return null;
}

function scanDirForEmail(dirPath: string, depth = 0): string | null {
  if (depth > 3 || !fs.existsSync(dirPath)) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = scanDirForEmail(full, depth + 1);
      if (nested) return nested;
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(full, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      for (const key of ['email', 'account_email', 'user_email']) {
        if (typeof parsed[key] === 'string' && EMAIL_REGEX.test(parsed[key] as string)) {
          return parsed[key] as string;
        }
      }
      if (typeof parsed.tokens === 'object' && parsed.tokens !== null) {
        const tokens = parsed.tokens as Record<string, unknown>;
        if (typeof tokens.id_token === 'string') {
          const jwtEmail = extractEmailFromJwt(tokens.id_token);
          if (jwtEmail) return jwtEmail;
        }
      }
      if (typeof parsed.id_token === 'string') {
        const jwtEmail = extractEmailFromJwt(parsed.id_token);
        if (jwtEmail) return jwtEmail;
      }
      const match = raw.match(EMAIL_REGEX);
      if (match) return match[0];
    } catch {
      // Ignore unreadable or non-JSON file
    }
  }
  return null;
}

export function syncAccountEmailFromProfile(account: Account, vault: AzuronAccountVault): string | null {
  if (!account.authProfilePath) return account.accountEmail ?? null;
  const detected = scanDirForEmail(account.authProfilePath);
  if (detected && detected !== account.accountEmail) {
    vault.updateAccountEmail(account.id, detected);
    vault.updateAccountStatus(account.id, 'active');
    return detected;
  }
  return account.accountEmail ?? null;
}

export async function launchProviderOAuth(
  account: Account,
  vault: AzuronAccountVault,
  hub: AzuronStreamHub,
): Promise<OAuthLaunchResult> {
  const profilePath = account.authProfilePath || '';
  if (profilePath) {
    fs.mkdirSync(profilePath, { recursive: true });
  }

  const { bin, resolvedPath, args } = resolveProviderBinary(account.provider);
  const command = `${bin} ${args.join(' ')}`;

  if (!resolvedPath) {
    return {
      ok: true,
      accountId: account.id,
      provider: account.provider,
      profilePath,
      command,
      oauthUrl: null,
      cliAvailable: false,
      email: account.accountEmail ?? null,
      message: `${bin} CLI is not installed in PATH yet. Install ${bin} (or set ${account.provider === 'codex' ? 'AZURON_CODEX_BIN' : 'AZURON_AGY_BIN'}) to generate a live browser OAuth login link.`,
    };
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: profilePath || process.env.HOME,
    AZURON_PROFILE_DIR: profilePath,
    CODEX_HOME: profilePath,
    BROWSER: 'echo',
  };

  return new Promise<OAuthLaunchResult>((resolve) => {
    let settled = false;
    let capturedUrl: string | null = null;
    let outputBuf = '';

    const child = spawn(resolvedPath, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finishPrompt = (cliMessage?: string) => {
      if (settled) return;
      settled = true;
      resolve({
        ok: true,
        accountId: account.id,
        provider: account.provider,
        profilePath,
        command,
        oauthUrl: capturedUrl,
        cliAvailable: true,
        email: account.accountEmail ?? null,
        message:
          cliMessage ||
          (capturedUrl
            ? 'Open the OAuth link in your browser, select your account, and complete sign-in. AZURON will detect your email automatically.'
            : `Started ${command} in isolated profile. Complete sign-in if prompted.`),
      });
    };

    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      outputBuf += text;
      if (!capturedUrl) {
        const match = outputBuf.match(URL_REGEX);
        if (match) {
          capturedUrl = match[0];
          finishPrompt();
        }
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) => {
      finishPrompt(`Failed to launch ${command}: ${err.message}`);
    });

    child.on('close', (code) => {
      const detectedEmail = syncAccountEmailFromProfile(account, vault);
      if (code === 0) {
        vault.updateAccountStatus(account.id, 'active');
        hub.emit('system', account.id, 'system.log', {
          kind: 'account.oauth',
          accountId: account.id,
          status: 'connected',
          email: detectedEmail,
        });
      }
      finishPrompt(
        code === 0
          ? `Authenticated${detectedEmail ? ` as ${detectedEmail}` : ''}.`
          : `${command} exited with code ${code}.`,
      );
    });

    // Wait up to 3.5s for OAuth URL before returning to browser UI
    setTimeout(() => finishPrompt(), 3500);
  });
}
