import React, { useEffect, useState } from 'react';
import { CloudUpload, HardDrive, Trash2 } from 'lucide-react';
import type { RetentionPolicy } from '@azuron/contract';
import { apiJson } from '../lib/api.js';

interface StorageData {
  breakdown: {
    dbBytes: number;
    chatsBytes: number;
    logsBytes: number;
    tmpBytes: number;
    totalBytes: number;
  };
  policies: RetentionPolicy[];
}

interface CleanupReport {
  dryRun: boolean;
  freedBytes: number;
  archivedChatsCount: number;
  deletedTasksCount: number;
  deletedTempFilesCount: number;
}

interface BackupResult {
  ok: boolean;
  destination: string;
  output: string;
}

export const StoragePage: React.FC = () => {
  const [data, setData] = useState<StorageData | null>(null);
  const [report, setReport] = useState<CleanupReport | null>(null);
  const [backupRemote, setBackupRemote] = useState('');
  const [backupScope, setBackupScope] = useState<'full' | 'project'>('full');
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);
  const [backupRunning, setBackupRunning] = useState(false);

  const load = async () => {
    setData(await apiJson<StorageData>('/api/storage'));
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCleanup = async (dryRun: boolean) => {
    const res = await apiJson<{ report: CleanupReport }>('/api/storage/cleanup', {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    });
    setReport(res.report);
    if (!dryRun) await load();
  };

  const handleBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupRemote.trim()) return;
    setBackupRunning(true);
    setBackupResult(null);
    try {
      const res = await apiJson<BackupResult>('/api/storage/backup', {
        method: 'POST',
        body: JSON.stringify({ remoteName: backupRemote.trim(), scope: backupScope }),
      });
      setBackupResult(res);
    } catch (err) {
      setBackupResult({
        ok: false,
        destination: '',
        output: err instanceof Error ? err.message : 'Backup request failed',
      });
    } finally {
      setBackupRunning(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Smart Storage Retention Engine</h1>
          <p className="text-xs opacity-80">Activity-based retention protecting Android flash storage</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleCleanup(true)}
            className="px-3 py-1.5 rounded border text-xs cursor-pointer"
            style={{ borderColor: 'var(--az-border)' }}
          >
            Dry-Run Preview
          </button>
          <button
            type="button"
            onClick={() => void handleCleanup(false)}
            className="px-3 py-1.5 rounded text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
          >
            <Trash2 size={13} />
            <span>Run Cleanup</span>
          </button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ['SQLite DB', data.breakdown.dbBytes],
            ['Chats Dir', data.breakdown.chatsBytes],
            ['Logs Dir', data.breakdown.logsBytes],
            ['Temp Dir', data.breakdown.tmpBytes],
          ].map(([label, bytes]) => (
            <div key={String(label)} className="p-3.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
              <div className="flex items-center gap-1.5 text-xs opacity-80">
                <HardDrive size={13} />
                <span>{label}</span>
              </div>
              <div className="text-base font-mono font-semibold mt-1">
                {(Number(bytes) / 1024).toFixed(1)} KB
              </div>
            </div>
          ))}
        </div>
      )}

      {report && (
        <div className="p-3.5 rounded border text-xs font-mono space-y-1" style={{ borderColor: 'var(--az-accent)' }}>
          <div>{report.dryRun ? '[DRY-RUN PREVIEW]' : '[CLEANUP COMPLETE]'}</div>
          <div>
            Archived Chats: {report.archivedChatsCount} | Deleted Tasks: {report.deletedTasksCount} |
            Temp Files: {report.deletedTempFilesCount} | Freed: {report.freedBytes} bytes
          </div>
        </div>
      )}

      <div className="space-y-2">
        {data?.policies.map((p) => (
          <div key={p.category} className="p-3 rounded border flex items-center justify-between text-xs" style={{ borderColor: 'var(--az-border)' }}>
            <span className="font-mono">{p.category}</span>
            <span className="font-mono">
              {p.retentionDays} days • {p.isEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        ))}
      </div>

      {/* Cloud Backup via rclone */}
      <div className="p-4 rounded border space-y-3" style={{ borderColor: 'var(--az-border)' }}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <CloudUpload size={15} />
          <span>Cloud Backup (rclone)</span>
        </div>
        <p className="text-xs opacity-70">
          Push your AZURON data to any configured rclone remote (Dropbox, GDrive, S3, SFTP, etc.).
          Configure remotes with <code className="font-mono text-xs">rclone config</code> first.
        </p>

        <form onSubmit={(e) => void handleBackup(e)} className="flex flex-wrap gap-2 items-center">
          <input
            value={backupRemote}
            onChange={(e) => setBackupRemote(e.target.value)}
            placeholder="rclone remote name (e.g. gdrive)"
            className="flex-1 min-w-[180px] px-3 py-1.5 rounded border bg-transparent text-xs font-mono outline-none"
            style={{ borderColor: 'var(--az-border)' }}
          />
          <select
            value={backupScope}
            onChange={(e) => setBackupScope(e.target.value as 'full' | 'project')}
            className="px-3 py-1.5 rounded border text-xs font-mono"
            style={{ borderColor: 'var(--az-border)', backgroundColor: 'var(--az-bg)' }}
          >
            <option value="full">Full AZURON Home</option>
            <option value="project">Active Project Only</option>
          </select>
          <button
            type="submit"
            disabled={backupRunning || !backupRemote.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
          >
            <CloudUpload size={13} />
            {backupRunning ? 'Backing Up...' : 'Start Backup'}
          </button>
        </form>

        {backupResult && (
          <div
            className="p-3 rounded border text-xs font-mono space-y-1"
            style={{
              borderColor: backupResult.ok ? '#22C55E' : '#EF4444',
              color: backupResult.ok ? '#22C55E' : '#EF4444',
            }}
          >
            <div>{backupResult.ok ? '[CHECK] Backup completed' : '[ERROR] Backup failed'}</div>
            {backupResult.destination && <div>Destination: {backupResult.destination}</div>}
            {backupResult.output && (
              <pre className="whitespace-pre-wrap opacity-80" style={{ fontSize: '0.68rem' }}>
                {backupResult.output}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
