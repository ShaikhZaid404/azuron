import React, { useEffect, useState } from 'react';
import { FolderPlus, GitBranch, Layers, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { Project, Task, TaskStatus } from '@azuron/contract';
import { apiJson } from '../lib/api.js';

export const TasksPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projName, setProjName] = useState('');
  const [projPath, setProjPath] = useState('');
  const [taskProjectId, setTaskProjectId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const load = async () => {
    const [p, t] = await Promise.all([
      apiJson<{ projects: Project[] }>('/api/projects'),
      apiJson<{ tasks: Task[] }>('/api/tasks'),
    ]);
    setProjects(p.projects);
    setTasks(t.tasks);
    if (!taskProjectId && p.projects[0]) setTaskProjectId(p.projects[0].id);
  };

  useEffect(() => {
    void load();
  }, []);

  const handleRegisterProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await apiJson('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: projName.trim(), filesystemPath: projPath.trim() }),
      });
      setProjName('');
      setProjPath('');
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to register project');
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskProjectId || !taskTitle.trim() || !taskPrompt.trim()) return;
    await apiJson('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        projectId: taskProjectId,
        title: taskTitle.trim(),
        prompt: taskPrompt.trim(),
      }),
    });
    setTaskTitle('');
    setTaskPrompt('');
    await load();
  };

  const handleStatus = async (id: string, status: TaskStatus) => {
    await apiJson(`/api/tasks/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await load();
  };

  const handleProtect = async (task: Task) => {
    await apiJson(`/api/tasks/${task.id}/protect`, {
      method: 'PATCH',
      body: JSON.stringify({ isProtected: !task.isProtected }),
    });
    await load();
  };

  const handlePrepare = async (taskId: string) => {
    setPreparingId(taskId);
    setErrorMsg(null);
    try {
      await apiJson(`/api/tasks/${taskId}/prepare`, { method: 'POST' });
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to prepare worktree');
    } finally {
      setPreparingId(null);
    }
  };

  const handleReview = async (taskId: string, decision: 'approve_merge' | 'reject') => {
    setReviewingId(taskId);
    setErrorMsg(null);
    try {
      await apiJson(`/api/tasks/${taskId}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      await load();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setReviewingId(null);
    }
  };

  const statusColor = (s: TaskStatus) => {
    if (s === 'done') return '#22C55E';
    if (s === 'failed') return '#EF4444';
    if (s === 'review') return '#F59E0B';
    if (s === 'running') return 'var(--az-accent)';
    return 'var(--az-fg)';
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Projects & Task Orchestration</h1>
        <p className="text-xs opacity-80">Register local git projects, queue coding tasks, and manage Review Gates</p>
      </div>

      {errorMsg && (
        <div className="p-3 rounded border text-xs font-mono" style={{ borderColor: '#EF4444', color: '#EF4444' }}>
          [ERROR] {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <form onSubmit={(e) => void handleRegisterProject(e)} className="p-4 rounded border space-y-2.5" style={{ borderColor: 'var(--az-border)' }}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FolderPlus size={15} />
            <span>Register Local Project</span>
          </div>
          <input
            value={projName}
            onChange={(e) => setProjName(e.target.value)}
            placeholder="Project Name (e.g. azuron)"
            className="w-full px-3 py-1.5 rounded border bg-transparent text-xs outline-none"
            style={{ borderColor: 'var(--az-border)' }}
          />
          <input
            value={projPath}
            onChange={(e) => setProjPath(e.target.value)}
            placeholder="/data/user/0/com.agy/files/azuron"
            className="w-full px-3 py-1.5 rounded border bg-transparent text-xs font-mono outline-none"
            style={{ borderColor: 'var(--az-border)' }}
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
          >
            Add Project
          </button>
        </form>

        <form onSubmit={(e) => void handleCreateTask(e)} className="p-4 rounded border space-y-2.5" style={{ borderColor: 'var(--az-border)' }}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Layers size={15} />
            <span>Queue Coding Task</span>
          </div>
          <select
            value={taskProjectId}
            onChange={(e) => setTaskProjectId(e.target.value)}
            className="w-full px-3 py-1.5 rounded border bg-transparent text-xs font-mono"
            style={{ borderColor: 'var(--az-border)' }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id} style={{ backgroundColor: 'var(--az-bg)' }}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task Title"
            className="w-full px-3 py-1.5 rounded border bg-transparent text-xs outline-none"
            style={{ borderColor: 'var(--az-border)' }}
          />
          <input
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            placeholder="Task Instructions..."
            className="w-full px-3 py-1.5 rounded border bg-transparent text-xs outline-none"
            style={{ borderColor: 'var(--az-border)' }}
          />
          <button
            type="submit"
            disabled={!taskProjectId}
            className="px-3 py-1.5 rounded text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
          >
            Enqueue Task
          </button>
        </form>
      </div>

      <div className="space-y-2">
        {tasks.map((t) => (
          <div key={t.id} className="p-3.5 rounded border space-y-2.5" style={{ borderColor: 'var(--az-border)' }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{t.title}</div>
                <div className="text-xs font-mono opacity-80 flex items-center gap-1.5 mt-0.5">
                  <span style={{ color: statusColor(t.status) }}>{t.status.toUpperCase()}</span>
                  <span className="opacity-40">•</span>
                  {t.branchName ? (
                    <>
                      <GitBranch size={10} />
                      <span>{t.branchName}</span>
                      <span className="opacity-40">•</span>
                    </>
                  ) : null}
                  <span>{t.provider}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Keep Forever toggle */}
                <button
                  type="button"
                  onClick={() => void handleProtect(t)}
                  className="p-1.5 rounded border cursor-pointer"
                  style={{
                    borderColor: t.isProtected ? 'var(--az-accent)' : 'var(--az-border)',
                    color: t.isProtected ? 'var(--az-accent)' : 'var(--az-fg)',
                  }}
                  title="Keep Forever"
                >
                  <ShieldCheck size={14} />
                </button>

                {/* Prepare Worktree button — only for queued tasks */}
                {t.status === 'queued' && (
                  <button
                    type="button"
                    disabled={preparingId === t.id}
                    onClick={() => void handlePrepare(t.id)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium cursor-pointer disabled:opacity-50"
                    style={{ borderColor: 'var(--az-border)' }}
                  >
                    <GitBranch size={12} />
                    {preparingId === t.id ? 'Preparing...' : 'Prepare Worktree'}
                  </button>
                )}

                {/* Mark Done for queued */}
                {t.status === 'queued' && (
                  <button
                    type="button"
                    onClick={() => void handleStatus(t.id, 'done')}
                    className="px-2.5 py-1 rounded text-xs font-medium cursor-pointer"
                    style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
                  >
                    Mark Done
                  </button>
                )}
              </div>
            </div>

            {/* Review Gate — shown when task status is 'review' */}
            {t.status === 'review' && (
              <div
                className="p-3 rounded border space-y-2"
                style={{ borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.06)' }}
              >
                <div className="text-xs font-semibold" style={{ color: '#F59E0B' }}>
                  [REVIEW] Task is awaiting code review gate
                </div>
                {t.branchName && (
                  <div className="text-xs font-mono opacity-80">
                    Branch: {t.branchName}
                    {t.worktreePath && <> — Worktree: {t.worktreePath}</>}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    disabled={reviewingId === t.id}
                    onClick={() => void handleReview(t.id, 'approve_merge')}
                    className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold cursor-pointer disabled:opacity-50"
                    style={{ backgroundColor: '#22C55E', color: '#000' }}
                  >
                    <ThumbsUp size={12} />
                    {reviewingId === t.id ? 'Processing...' : 'Approve & Merge'}
                  </button>
                  <button
                    type="button"
                    disabled={reviewingId === t.id}
                    onClick={() => void handleReview(t.id, 'reject')}
                    className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold cursor-pointer disabled:opacity-50"
                    style={{ backgroundColor: '#EF4444', color: '#fff' }}
                  >
                    <ThumbsDown size={12} />
                    {reviewingId === t.id ? 'Processing...' : 'Reject'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
