import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { RetentionCategory, RetentionPolicy } from '@azuron/contract';
import type { AzuronPaths } from '../core/paths.js';

export interface CleanupReport {
  dryRun: boolean;
  freedBytes: number;
  archivedChatsCount: number;
  deletedTasksCount: number;
  deletedTempFilesCount: number;
  deletedUsageRowsCount: number;
  candidates: Array<{ category: RetentionCategory; id: string; bytes: number; label: string }>;
}

function getDirSizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirSizeBytes(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

export class AzuronStorageRetentionEngine {
  private readonly db: DatabaseSync;
  private readonly paths: AzuronPaths;

  constructor(db: DatabaseSync, paths: AzuronPaths) {
    this.db = db;
    this.paths = paths;
  }

  public listPolicies(): RetentionPolicy[] {
    const rows = this.db
      .prepare('SELECT category, retention_days, is_enabled, last_cleaned_at FROM retention_policies')
      .all() as Array<{
      category: RetentionCategory;
      retention_days: number;
      is_enabled: number;
      last_cleaned_at: number | null;
    }>;

    return rows.map((r) => ({
      category: r.category,
      retentionDays: r.retention_days,
      isEnabled: r.is_enabled === 1,
      lastCleanedAt: r.last_cleaned_at,
    }));
  }

  public updatePolicy(category: RetentionCategory, retentionDays: number, isEnabled: boolean): RetentionPolicy {
    this.db
      .prepare('UPDATE retention_policies SET retention_days = ?, is_enabled = ? WHERE category = ?')
      .run(retentionDays, isEnabled ? 1 : 0, category);
    return this.listPolicies().find((p) => p.category === category)!;
  }

  public getStorageBreakdown(): {
    dbBytes: number;
    chatsBytes: number;
    logsBytes: number;
    tmpBytes: number;
    totalBytes: number;
  } {
    const dbBytes = fs.existsSync(this.paths.dbPath) ? fs.statSync(this.paths.dbPath).size : 0;
    const chatsBytes = getDirSizeBytes(this.paths.chatsDir);
    const logsBytes = getDirSizeBytes(this.paths.logsDir);
    const tmpBytes = getDirSizeBytes(this.paths.tmpDir);
    return {
      dbBytes,
      chatsBytes,
      logsBytes,
      tmpBytes,
      totalBytes: dbBytes + chatsBytes + logsBytes + tmpBytes,
    };
  }

  public runCleanup(opts?: { dryRun?: boolean; nowMs?: number }): CleanupReport {
    const dryRun = opts?.dryRun ?? false;
    const now = opts?.nowMs ?? Date.now();
    const policies = new Map(this.listPolicies().map((p) => [p.category, p]));
    const report: CleanupReport = {
      dryRun,
      freedBytes: 0,
      archivedChatsCount: 0,
      deletedTasksCount: 0,
      deletedTempFilesCount: 0,
      deletedUsageRowsCount: 0,
      candidates: [],
    };

    const dayMs = 24 * 60 * 60 * 1000;

    // 1. Task logs older than 7 days (unless protected)
    const taskPolicy = policies.get('task_logs');
    if (taskPolicy?.isEnabled) {
      const cutoff = now - taskPolicy.retentionDays * dayMs;
      const oldTasks = this.db
        .prepare(
          `SELECT id, title FROM tasks
           WHERE is_protected = 0 AND settled_at IS NOT NULL AND settled_at < ?`,
        )
        .all(cutoff) as Array<{ id: string; title: string }>;

      for (const t of oldTasks) {
        const logFile = path.join(this.paths.logsDir, 'tasks', `${t.id}.log`);
        const bytes = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
        report.candidates.push({ category: 'task_logs', id: t.id, bytes, label: t.title });
        report.freedBytes += bytes;
        report.deletedTasksCount += 1;
        if (!dryRun) {
          if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
          this.db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
        }
      }
    }

    // 2. Inactive chats older than 30 days (skip pinned or Keep Forever protected)
    const chatPolicy = policies.get('inactive_chats');
    if (chatPolicy?.isEnabled) {
      const cutoff = now - chatPolicy.retentionDays * dayMs;
      const staleChats = this.db
        .prepare(
          `SELECT id, title FROM conversations
           WHERE is_pinned = 0 AND is_protected = 0 AND is_archived = 0 AND last_activity_at < ?`,
        )
        .all(cutoff) as Array<{ id: string; title: string }>;

      for (const c of staleChats) {
        report.candidates.push({ category: 'inactive_chats', id: c.id, bytes: 0, label: c.title });
        report.archivedChatsCount += 1;
        if (!dryRun) {
          this.db.prepare('UPDATE conversations SET is_archived = 1 WHERE id = ?').run(c.id);
        }
      }
    }

    // 3. Temp files older than 2 days
    const tmpPolicy = policies.get('temp_files');
    if (tmpPolicy?.isEnabled && fs.existsSync(this.paths.tmpDir)) {
      const cutoff = now - tmpPolicy.retentionDays * dayMs;
      for (const entry of fs.readdirSync(this.paths.tmpDir, { withFileTypes: true })) {
        const full = path.join(this.paths.tmpDir, entry.name);
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
          const bytes = entry.isDirectory() ? getDirSizeBytes(full) : stat.size;
          report.candidates.push({ category: 'temp_files', id: entry.name, bytes, label: entry.name });
          report.freedBytes += bytes;
          report.deletedTempFilesCount += 1;
          if (!dryRun) {
            fs.rmSync(full, { recursive: true, force: true });
          }
        }
      }
    }

    // 4. Usage history older than 1 year
    const usagePolicy = policies.get('usage_history');
    if (usagePolicy?.isEnabled) {
      const cutoff = now - usagePolicy.retentionDays * dayMs;
      const res = dryRun
        ? (this.db.prepare('SELECT COUNT(*) as cnt FROM usage_records WHERE recorded_at < ?').get(cutoff) as { cnt: number })
        : this.db.prepare('DELETE FROM usage_records WHERE recorded_at < ?').run(cutoff);
      report.deletedUsageRowsCount = dryRun ? Number((res as { cnt: number }).cnt) : Number((res as { changes: number | bigint }).changes);
    }

    if (!dryRun) {
      this.db.prepare('UPDATE retention_policies SET last_cleaned_at = ?').run(now);
    }

    return report;
  }
}
