import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import type { EnvironmentToolchain, IntegrationStatus } from '@azuron/contract';
import type { AzuronAccountVault } from './vault.js';

const execFileAsync = promisify(execFile);

async function probeCommand(cmd: string, args: string[], timeoutMs = 2500): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
    });
    return { ok: true, stdout: stdout.trim() };
  } catch {
    return { ok: false, stdout: '' };
  }
}

async function resolveBinary(name: string, overrideEnv?: string): Promise<string | null> {
  if (overrideEnv && process.env[overrideEnv]) {
    return process.env[overrideEnv]!;
  }
  const which = await probeCommand('which', [name]);
  return which.ok && which.stdout ? which.stdout.split('\n')[0]!.trim() : null;
}

export class AzuronEnvironmentInspector {
  public async inspect(): Promise<EnvironmentToolchain> {
    const [
      npmRes,
      py3Res,
      pyRes,
      gitNameRes,
      gitEmailRes,
      ghRes,
      rcloneBin,
      agyBin,
      codexBin,
    ] = await Promise.all([
      probeCommand('npm', ['--version']),
      probeCommand('python3', ['--version']),
      probeCommand('python', ['--version']),
      probeCommand('git', ['config', '--get', 'user.name']),
      probeCommand('git', ['config', '--get', 'user.email']),
      probeCommand('gh', ['auth', 'status']),
      resolveBinary('rclone'),
      resolveBinary('agy', 'AZURON_AGY_BIN'),
      resolveBinary('codex', 'AZURON_CODEX_BIN'),
    ]);

    const pythonRaw = py3Res.ok ? py3Res.stdout : pyRes.ok ? pyRes.stdout : null;
    let ghAccount: string | null = null;
    if (ghRes.ok) {
      const match = ghRes.stdout.match(/account\s+([^\s(]+)/i);
      ghAccount = match ? match[1]! : 'authenticated';
    }

    const isAndroidTermux =
      Boolean(process.env.TERMUX_VERSION) ||
      Boolean(process.env.PREFIX?.includes('com.termux')) ||
      Boolean(process.env.HOME?.includes('com.agy')) ||
      fs.existsSync('/system/bin/app_process');

    return {
      nodeVersion: process.version,
      npmVersion: npmRes.ok ? npmRes.stdout : null,
      pythonVersion: pythonRaw,
      gitUserName: gitNameRes.ok && gitNameRes.stdout ? gitNameRes.stdout : null,
      gitUserEmail: gitEmailRes.ok && gitEmailRes.stdout ? gitEmailRes.stdout : null,
      ghAuthenticated: ghRes.ok,
      ghAccount,
      rcloneInstalled: Boolean(rcloneBin),
      agyInstalled: Boolean(agyBin),
      agyBin,
      codexInstalled: Boolean(codexBin),
      codexBin,
      platform: os.platform(),
      arch: os.arch(),
      isAndroidTermux,
    };
  }

  public async getIntegrationStatuses(vault: AzuronAccountVault): Promise<IntegrationStatus[]> {
    const env = await this.inspect();
    const ghVault = vault.getIntegrationToken('github');
    const vercelVault = vault.getIntegrationToken('vercel');
    const rcloneVault = vault.getIntegrationToken('rclone');

    const github: IntegrationStatus = env.ghAuthenticated
      ? {
          name: 'github',
          connected: true,
          source: 'env_cli',
          accountLabel: env.ghAccount,
          details: 'Detected via gh auth status',
          updatedAt: null,
        }
      : ghVault.token
        ? {
            name: 'github',
            connected: true,
            source: 'vault_pat',
            accountLabel: ghVault.accountLabel ?? 'PAT Connected',
            details: ghVault.details ?? 'Stored in AES-256-GCM vault',
            updatedAt: ghVault.updatedAt,
          }
        : {
            name: 'github',
            connected: false,
            source: 'none',
            accountLabel: null,
            details: 'Run gh auth login or connect a GitHub PAT',
            updatedAt: null,
          };

    const vercel: IntegrationStatus = vercelVault.token
      ? {
          name: 'vercel',
          connected: true,
          source: 'vault_pat',
          accountLabel: vercelVault.accountLabel ?? 'Vercel Connected',
          details: vercelVault.details ?? 'Stored in AES-256-GCM vault',
          updatedAt: vercelVault.updatedAt,
        }
      : {
          name: 'vercel',
          connected: false,
          source: 'none',
          accountLabel: null,
          details: 'Connect a Vercel Personal Access Token',
          updatedAt: null,
        };

    const rclone: IntegrationStatus = env.rcloneInstalled
      ? {
          name: 'rclone',
          connected: true,
          source: 'env_cli',
          accountLabel: rcloneVault.accountLabel ?? 'rclone ready',
          details: rcloneVault.details ?? 'rclone CLI detected on system',
          updatedAt: rcloneVault.updatedAt,
        }
      : {
          name: 'rclone',
          connected: false,
          source: 'none',
          accountLabel: null,
          details: 'Install via pkg install rclone for cloud backups',
          updatedAt: null,
        };

    return [github, vercel, rclone];
  }
}
