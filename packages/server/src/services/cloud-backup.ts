import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AzuronPaths } from '../core/paths.js';

const execFileAsync = promisify(execFile);

export class AzuronCloudBackupService {
  private readonly paths: AzuronPaths;

  constructor(paths: AzuronPaths) {
    this.paths = paths;
  }

  public async backupPath(
    sourcePath: string,
    remoteName: string,
    remoteSubdir: string,
  ): Promise<{ ok: boolean; destination: string; output: string }> {
    const destination = `${remoteName}:azuron-backups/${remoteSubdir}`;
    try {
      const { stdout, stderr } = await execFileAsync(
        'rclone',
        ['copy', sourcePath, destination, '--create-empty-src-dirs'],
        { timeout: 60_000, maxBuffer: 512 * 1024 },
      );
      return {
        ok: true,
        destination,
        output: [stdout, stderr].filter(Boolean).join('\n').trim() || 'Backup completed.',
      };
    } catch (err) {
      return {
        ok: false,
        destination,
        output: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async backupFullAzuron(remoteName: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return this.backupPath(this.paths.homeDir, remoteName, `full-${stamp}`);
  }
}
