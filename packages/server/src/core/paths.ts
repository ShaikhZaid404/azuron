import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AzuronPaths {
  homeDir: string;
  dbPath: string;
  pidPath: string;
  secretsDir: string;
  masterKeyPath: string;
  profilesDir: string;
  chatsDir: string;
  globalChatsDir: string;
  projectChatsDir: string;
  logsDir: string;
  logFilePath: string;
  tmpDir: string;
}

export function resolveAzuronPaths(customHomeDir?: string): AzuronPaths {
  const homeDir = customHomeDir || process.env.AZURON_HOME || path.join(os.homedir(), '.azuron');
  const secretsDir = path.join(homeDir, 'secrets');
  const profilesDir = path.join(homeDir, 'profiles');
  const chatsDir = path.join(homeDir, 'chats');
  const logsDir = path.join(homeDir, 'logs');
  const tmpDir = path.join(homeDir, 'tmp');

  return {
    homeDir,
    dbPath: path.join(homeDir, 'azuron.db'),
    pidPath: path.join(homeDir, 'azuron.pid'),
    secretsDir,
    masterKeyPath: path.join(secretsDir, 'master.key'),
    profilesDir,
    chatsDir,
    globalChatsDir: path.join(chatsDir, 'global'),
    projectChatsDir: path.join(chatsDir, 'projects'),
    logsDir,
    logFilePath: path.join(logsDir, 'azuron.log'),
    tmpDir,
  };
}

export function ensureAzuronDirectories(paths: AzuronPaths): void {
  const dirs = [
    paths.homeDir,
    paths.secretsDir,
    path.join(paths.profilesDir, 'antigravity'),
    path.join(paths.profilesDir, 'codex'),
    paths.globalChatsDir,
    paths.projectChatsDir,
    paths.logsDir,
    path.join(paths.logsDir, 'tasks'),
    paths.tmpDir,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
