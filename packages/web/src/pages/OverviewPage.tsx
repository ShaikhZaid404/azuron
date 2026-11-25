import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Cpu, HardDrive, Layers, Terminal } from 'lucide-react';
import type { EnvironmentToolchain, Task } from '@azuron/contract';
import { apiJson } from '../lib/api.js';
import type { NavRoute } from '../components/AppShell.js';

interface HealthResponse {
  name: string;
  status: string;
  uptimeSec: number;
  memoryMb: number;
  heapUsedMb: number;
  toolchain: EnvironmentToolchain;
}

export const OverviewPage: React.FC<{ onNavigate: (r: NavRoute) => void }> = ({ onNavigate }) => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [storageTotalBytes, setStorageTotalBytes] = useState<number>(0);

  useEffect(() => {
    void apiJson<HealthResponse>('/api/health').then(setHealth).catch(() => {});
    void apiJson<{ tasks: Task[] }>('/api/tasks').then((d) => setTasks(d.tasks)).catch(() => {});
    void apiJson<{ breakdown: { totalBytes: number } }>('/api/storage')
      .then((d) => setStorageTotalBytes(d.breakdown.totalBytes))
      .catch(() => {});
  }, []);

  const needsYou = tasks.filter((t) => t.status === 'review').length;
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'queued').length;
  const completed = tasks.filter((t) => t.status === 'done').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Workspace Overview</h1>
          <p className="text-xs opacity-80 mt-0.5">
            Local-first orchestration across Google Antigravity and OpenAI Codex
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('chat')}
            className="px-3 py-2 rounded text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
          >
            New Chat
          </button>
          <button
            type="button"
            onClick={() => onNavigate('terminal')}
            className="px-3 py-2 rounded text-xs font-medium border cursor-pointer"
            style={{ borderColor: 'var(--az-border)' }}
          >
            AI Terminal
          </button>
        </div>
      </div>

      {/* Workspace Health & Attention Strip */}
      <div
        className="px-4 py-2.5 rounded border text-xs font-mono flex flex-wrap items-center gap-4"
        style={{ borderColor: 'var(--az-border)' }}
      >
        <span>[STATUS: {health?.status?.toUpperCase() ?? 'LOADING'}]</span>
        <span>[RAM: {health?.memoryMb ?? 0} MB]</span>
        <span>[UPTIME: {health?.uptimeSec ?? 0}s]</span>
        <span>[STORAGE: {(storageTotalBytes / 1024).toFixed(1)} KB]</span>
      </div>

      {/* 4 Bento Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Needs You', value: needsYou, sub: 'Awaiting review', icon: Activity },
          { label: 'Running / Queued', value: running, sub: 'Active fleet', icon: Layers },
          { label: 'Completed', value: completed, sub: 'Settled tasks', icon: CheckCircle2 },
          { label: 'Failed', value: failed, sub: 'Error state', icon: Terminal },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => onNavigate('tasks')}
              className="p-4 rounded border text-left cursor-pointer"
              style={{ borderColor: 'var(--az-border)', backgroundColor: 'var(--az-bg)' }}
            >
              <div className="flex items-center justify-between text-xs mb-2">
                <span>{card.label}</span>
                <Icon size={15} />
              </div>
              <div className="text-2xl font-semibold font-mono">{card.value}</div>
              <div className="text-xs opacity-75 mt-1">{card.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Termux Environment Auto-Detection */}
      <div className="rounded border p-4 space-y-3" style={{ borderColor: 'var(--az-border)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Cpu size={16} />
            <span>Detected Host Environment & CLIs</span>
          </div>
          <span className="text-xs font-mono">
            {health?.toolchain.platform} / {health?.toolchain.arch}
          </span>
        </div>

        {health ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs font-mono">
            <div className="p-2.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
              Node.js: {health.toolchain.nodeVersion ?? 'Missing'}
            </div>
            <div className="p-2.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
              Antigravity (agy): {health.toolchain.agyInstalled ? 'Detected' : 'Not Installed'}
            </div>
            <div className="p-2.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
              Codex (codex): {health.toolchain.codexInstalled ? 'Detected' : 'Not Installed'}
            </div>
            <div className="p-2.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
              Git User: {health.toolchain.gitUserName ?? 'Unconfigured'}
            </div>
            <div className="p-2.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
              GitHub CLI (gh): {health.toolchain.ghAuthenticated ? health.toolchain.ghAccount : 'Not Authenticated'}
            </div>
            <div className="p-2.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
              rclone Backup: {health.toolchain.rcloneInstalled ? 'Ready' : 'Not Installed'}
            </div>
          </div>
        ) : (
          <div className="text-xs">Inspecting environment...</div>
        )}
      </div>

      <div
        className="rounded border p-4 flex items-center justify-between gap-3"
        style={{ borderColor: 'var(--az-border)' }}
      >
        <div className="flex items-center gap-3">
          <HardDrive size={18} />
          <div>
            <div className="text-sm font-medium">Smart Storage Retention Active</div>
            <div className="text-xs opacity-75">
              Defaults: 7d task logs, 30d inactive chats, 2d temp files. Pinned items protected.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('storage')}
          className="px-3 py-1.5 rounded border text-xs cursor-pointer"
          style={{ borderColor: 'var(--az-border)' }}
        >
          Manage Storage
        </button>
      </div>
    </div>
  );
};
