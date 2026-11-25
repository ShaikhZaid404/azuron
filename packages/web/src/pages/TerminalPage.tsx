import React, { useEffect, useState } from 'react';
import { Play, ShieldAlert, Terminal, XCircle } from 'lucide-react';
import type { Project, TerminalCommand } from '@azuron/contract';
import { apiJson } from '../lib/api.js';

export const TerminalPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [commands, setCommands] = useState<TerminalCommand[]>([]);
  const [confirmText, setConfirmText] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = async (pid?: string) => {
    const [projRes, cmdRes] = await Promise.all([
      apiJson<{ projects: Project[] }>('/api/projects'),
      apiJson<{ commands: TerminalCommand[] }>(
        `/api/terminal/commands${pid ? `?projectId=${encodeURIComponent(pid)}` : ''}`,
      ),
    ]);
    setProjects(projRes.projects);
    const activePid = pid || projRes.projects[0]?.id || '';
    if (!projectId && activePid) setProjectId(activePid);
    setCommands(cmdRes.commands);
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCompile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !projectId) return;
    setErrorMsg(null);
    try {
      await apiJson('/api/terminal/compile', {
        method: 'POST',
        body: JSON.stringify({ projectId, userPrompt: prompt.trim() }),
      });
      setPrompt('');
      await load(projectId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Compile failed');
    }
  };

  const handleDecide = async (cmd: TerminalCommand, decision: 'approved' | 'rejected') => {
    setErrorMsg(null);
    try {
      await apiJson(`/api/terminal/commands/${cmd.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          confirmationText: confirmText[cmd.id],
        }),
      });
      await load(projectId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Decision failed');
    }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">AI-Assisted Terminal</h1>
          <p className="text-xs opacity-80">
            Natural language to shell with 3-tier Safety Referee and Android noexec compliance
          </p>
        </div>
        <select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            void load(e.target.value);
          }}
          className="px-3 py-1.5 rounded border bg-transparent text-xs font-mono"
          style={{ borderColor: 'var(--az-border)' }}
        >
          {projects.length === 0 && <option value="">Register a project first</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id} style={{ backgroundColor: 'var(--az-bg)' }}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {errorMsg && (
        <div className="p-3 rounded border text-xs font-mono" style={{ borderColor: '#EF4444', color: '#EF4444' }}>
          [ERROR] {errorMsg}
        </div>
      )}

      <form onSubmit={(e) => void handleCompile(e)} className="flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. git status check karo, list files, or run tests"
          className="flex-1 px-3 py-2 rounded border bg-transparent text-sm outline-none"
          style={{ borderColor: 'var(--az-border)' }}
        />
        <button
          type="submit"
          disabled={!projectId}
          className="px-4 py-2 rounded text-xs font-semibold cursor-pointer"
          style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
        >
          Compile Preview
        </button>
      </form>

      <div className="space-y-3">
        {commands.map((cmd) => {
          const badgeColor =
            cmd.riskLevel === 'destructive'
              ? '#EF4444'
              : cmd.riskLevel === 'moderate'
                ? '#F59E0B'
                : '#22C55E';

          return (
            <div key={cmd.id} className="p-4 rounded border space-y-2.5" style={{ borderColor: 'var(--az-border)' }}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 font-medium">
                  <Terminal size={14} />
                  <span>{cmd.userPrompt}</span>
                </span>
                <span
                  className="px-2 py-0.5 rounded border font-mono uppercase text-[11px]"
                  style={{ borderColor: badgeColor, color: badgeColor }}
                >
                  {cmd.riskLevel}
                </span>
              </div>

              <pre
                className="p-2.5 rounded border text-xs font-mono overflow-x-auto"
                style={{ borderColor: 'var(--az-border)' }}
              >
                {cmd.compiledCommand}
              </pre>
              <div className="text-xs opacity-80">{cmd.explanation}</div>

              {cmd.approvalStatus === 'pending' ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {cmd.riskLevel === 'destructive' && (
                    <div className="flex items-center gap-2">
                      <ShieldAlert size={14} color="#EF4444" />
                      <input
                        value={confirmText[cmd.id] ?? ''}
                        onChange={(e) =>
                          setConfirmText((prev) => ({ ...prev, [cmd.id]: e.target.value }))
                        }
                        placeholder='Type CONFIRM to run'
                        className="px-2.5 py-1 rounded border bg-transparent text-xs font-mono"
                        style={{ borderColor: '#EF4444' }}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDecide(cmd, 'approved')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold cursor-pointer"
                    style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
                  >
                    <Play size={13} />
                    <span>Approve & Run</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDecide(cmd, 'rejected')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs cursor-pointer"
                    style={{ borderColor: 'var(--az-border)' }}
                  >
                    <XCircle size={13} />
                    <span>Reject</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="text-xs font-mono">
                    Status: {cmd.approvalStatus.toUpperCase()} | Exit Code: {cmd.exitCode ?? 'N/A'}
                  </div>
                  {cmd.outputLog && (
                    <pre
                      className="p-2.5 rounded border text-xs font-mono max-h-48 overflow-y-auto"
                      style={{ borderColor: 'var(--az-border)' }}
                    >
                      {cmd.outputLog}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
