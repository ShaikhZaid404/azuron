import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import type { CreateProjectInput, CreateTaskInput, Project, Task, TaskStatus } from '@azuron/contract';
import type { AzuronStreamHub } from '../core/stream-hub.js';

const execFileAsync = promisify(execFile);

export class AzuronTaskManager {
  private readonly db: DatabaseSync;
  private readonly hub: AzuronStreamHub;

  constructor(db: DatabaseSync, hub: AzuronStreamHub) {
    this.db = db;
    this.hub = hub;
  }

  public listProjects(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapProject(r));
  }

  public createProject(input: CreateProjectInput): Project {
    const resolvedPath = path.resolve(input.filesystemPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Project directory does not exist: ${resolvedPath}`);
    }
    const id = `proj_${crypto.randomUUID().slice(0, 10)}`;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO projects (id, name, filesystem_path, base_branch, tags, instructions, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        resolvedPath,
        input.baseBranch ?? 'main',
        JSON.stringify(input.tags ?? []),
        input.instructions ?? '',
        now,
        now,
      );
    return this.getProject(id)!;
  }

  public getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapProject(row) : null;
  }

  public deleteProject(id: string): boolean {
    const res = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  public listTasks(projectId?: string): Task[] {
    const rows = (
      projectId
        ? this.db
            .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC')
            .all(projectId)
        : this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all()
    ) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapTask(r));
  }

  public createTask(input: CreateTaskInput): Task {
    const project = this.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }
    const id = `task_${crypto.randomUUID().slice(0, 10)}`;
    const branchName = `azuron/${id}`;
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, conversation_id, parent_task_id, title, prompt, status, provider, model, worktree_path, branch_name, diff_stat, peak_memory_mb, is_protected, settled_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, NULL, ?, NULL, 0, 0, NULL, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.conversationId ?? null,
        input.parentTaskId ?? null,
        input.title.trim(),
        input.prompt,
        input.provider,
        input.model,
        branchName,
        now,
        now,
      );

    const task = this.getTask(id)!;
    this.hub.emit('task', id, 'task.status', { status: 'queued', title: task.title });
    return task;
  }

  public getTask(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapTask(row) : null;
  }

  public updateTaskStatus(id: string, status: TaskStatus, diffStat?: string): Task | null {
    const current = this.getTask(id);
    if (!current) return null;
    const now = Date.now();
    const isSettled = status === 'done' || status === 'failed' || status === 'cancelled';

    this.db
      .prepare(
        `UPDATE tasks
         SET status = ?, diff_stat = COALESCE(?, diff_stat), settled_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, diffStat ?? null, isSettled ? now : null, now, id);

    const updated = this.getTask(id)!;
    this.hub.emit('task', id, 'task.status', { status, title: updated.title });
    if (isSettled) {
      this.hub.clearActiveRun(id);
    }
    return updated;
  }

  public setTaskProtected(id: string, isProtected: boolean): Task | null {
    this.db
      .prepare('UPDATE tasks SET is_protected = ?, updated_at = ? WHERE id = ?')
      .run(isProtected ? 1 : 0, Date.now(), id);
    return this.getTask(id);
  }

  public async prepareWorktree(id: string): Promise<Task> {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    const project = this.getProject(task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);

    const worktreeRoot = path.join(project.filesystemPath, '.azuron-worktrees');
    const worktreePath = path.join(worktreeRoot, id);
    const branchName = task.branchName || `azuron/${id}`;
    fs.mkdirSync(worktreeRoot, { recursive: true });

    try {
      await execFileAsync(
        'git',
        ['worktree', 'add', '-b', branchName, worktreePath, project.baseBranch],
        { cwd: project.filesystemPath },
      );
      this.db
        .prepare("UPDATE tasks SET worktree_path = ?, status = 'running', updated_at = ? WHERE id = ?")
        .run(worktreePath, Date.now(), id);
      this.hub.setActiveRun({
        id,
        kind: 'task',
        title: task.title,
        step: `Worktree ${branchName}`,
        startedAt: Date.now(),
      });
      this.hub.emit('task', id, 'task.status', { status: 'running', worktreePath });
    } catch {
      // Fallback for non-git projects: run in project root
      this.db
        .prepare("UPDATE tasks SET worktree_path = ?, status = 'running', updated_at = ? WHERE id = ?")
        .run(project.filesystemPath, Date.now(), id);
    }

    return this.getTask(id)!;
  }

  public async reviewTask(
    id: string,
    decision: 'approve_merge' | 'reject',
  ): Promise<Task> {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    const project = this.getProject(task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);

    if (
      task.worktreePath &&
      task.worktreePath !== project.filesystemPath &&
      fs.existsSync(task.worktreePath)
    ) {
      if (decision === 'approve_merge' && task.branchName) {
        try {
          await execFileAsync('git', ['merge', '--no-ff', task.branchName], {
            cwd: project.filesystemPath,
          });
        } catch {
          // Leave merge conflict for manual resolution if needed
        }
      }
      try {
        await execFileAsync('git', ['worktree', 'remove', '--force', task.worktreePath], {
          cwd: project.filesystemPath,
        });
      } catch {
        // Ignore worktree cleanup errors
      }
    }

    const nextStatus: TaskStatus = decision === 'approve_merge' ? 'done' : 'cancelled';
    return this.updateTaskStatus(id, nextStatus)!;
  }

  public async getProjectGitStatus(projectId: string): Promise<{
    isGitRepo: boolean;
    branch: string | null;
    statusText: string;
    diffStat: string;
  }> {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    try {
      const [branchRes, statusRes, diffRes] = await Promise.all([
        execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: project.filesystemPath }),
        execFileAsync('git', ['status', '-sb'], { cwd: project.filesystemPath }),
        execFileAsync('git', ['diff', '--stat'], { cwd: project.filesystemPath }),
      ]);
      return {
        isGitRepo: true,
        branch: branchRes.stdout.trim(),
        statusText: statusRes.stdout.trim(),
        diffStat: diffRes.stdout.trim(),
      };
    } catch {
      return { isGitRepo: false, branch: null, statusText: '', diffStat: '' };
    }
  }

  private mapProject(row: Record<string, unknown>): Project {
    return {
      id: String(row.id),
      name: String(row.name),
      filesystemPath: String(row.filesystem_path),
      baseBranch: String(row.base_branch),
      tags: row.tags ? (JSON.parse(String(row.tags)) as string[]) : [],
      instructions: row.instructions ? String(row.instructions) : '',
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private mapTask(row: Record<string, unknown>): Task {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      conversationId: row.conversation_id ? String(row.conversation_id) : null,
      parentTaskId: row.parent_task_id ? String(row.parent_task_id) : null,
      title: String(row.title),
      prompt: String(row.prompt ?? ''),
      status: String(row.status) as TaskStatus,
      provider: String(row.provider) as Task['provider'],
      model: String(row.model),
      worktreePath: row.worktree_path ? String(row.worktree_path) : null,
      branchName: row.branch_name ? String(row.branch_name) : null,
      diffStat: row.diff_stat ? String(row.diff_stat) : null,
      peakMemoryMb: Number(row.peak_memory_mb ?? 0),
      isProtected: Number(row.is_protected) === 1,
      settledAt: row.settled_at !== null && row.settled_at !== undefined ? Number(row.settled_at) : null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
