import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Loader, Play, Plus, Trash2 } from 'lucide-react';
import { useStreamHub } from '../hub/StreamHubContext.js';
import { apiJson } from '../lib/api.js';

interface WorkflowStep {
  name: string;
  kind: 'shell' | 'agent';
  commandOrPrompt: string;
  retries: number;
}

interface StepResult {
  name: string;
  status: 'done' | 'failed';
  attempts: number;
  output: string;
}

interface WorkflowResult {
  workflowName: string;
  status: 'done' | 'failed';
  steps: StepResult[];
}

interface RunHistory {
  id: string;
  name: string;
  startedAt: number;
  result: WorkflowResult | null;
  running: boolean;
}

function emptyStep(): WorkflowStep {
  return { name: '', kind: 'shell', commandOrPrompt: '', retries: 0 };
}

export const WorkflowsPage: React.FC = () => {
  const { subscribe } = useStreamHub();
  const [workflowName, setWorkflowName] = useState('');
  const [steps, setSteps] = useState<WorkflowStep[]>([emptyStep()]);
  const [runs, setRuns] = useState<RunHistory[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const nextRunId = useRef(0);

  // Subscribe to live task.log events from StreamHub
  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== 'task.log') return;
      setRuns((prev) =>
        prev.map((r) =>
          r.running
            ? { ...r, result: null } // keep spinner; result arrives via API response
            : r,
        ),
      );
    });
  }, [subscribe]);

  const updateStep = (idx: number, patch: Partial<WorkflowStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addStep = () => setSteps((prev) => [...prev, emptyStep()]);

  const removeStep = (idx: number) =>
    setSteps((prev) => prev.filter((_, i) => i !== idx));

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!workflowName.trim()) {
      setErrorMsg('Workflow name is required.');
      return;
    }
    if (steps.some((s) => !s.name.trim() || !s.commandOrPrompt.trim())) {
      setErrorMsg('Every step needs a name and command/prompt.');
      return;
    }

    const runId = `run_${++nextRunId.current}`;
    const newRun: RunHistory = {
      id: runId,
      name: workflowName.trim(),
      startedAt: Date.now(),
      result: null,
      running: true,
    };
    setRuns((prev) => [newRun, ...prev]);
    setExpandedRun(runId);
    setIsRunning(true);

    try {
      const json = await apiJson<{ result: WorkflowResult }>('/api/workflows/run', {
        method: 'POST',
        body: JSON.stringify({
          name: workflowName.trim(),
          steps,
        }),
      });
      setRuns((prev) =>
        prev.map((r) => (r.id === runId ? { ...r, result: json.result, running: false } : r)),
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to run workflow');
      setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, running: false } : r)));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Workflow Pipelines</h1>
        <p className="text-xs opacity-80">
          Define multi-step shell and agent pipelines. Each step runs sequentially with retry support.
        </p>
      </div>

      {errorMsg && (
        <div
          className="p-3 rounded border text-xs font-mono"
          style={{ borderColor: '#EF4444', color: '#EF4444' }}
        >
          [ERROR] {errorMsg}
        </div>
      )}

      <form onSubmit={(e) => void handleRun(e)} className="space-y-4">
        {/* Workflow name */}
        <div
          className="p-4 rounded border space-y-3"
          style={{ borderColor: 'var(--az-border)' }}
        >
          <div className="text-sm font-semibold">Pipeline Configuration</div>
          <input
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            placeholder="Workflow name (e.g. CI Lint + Test)"
            className="w-full px-3 py-1.5 rounded border bg-transparent text-xs outline-none"
            style={{ borderColor: 'var(--az-border)' }}
          />
        </div>

        {/* Step builder */}
        <div
          className="p-4 rounded border space-y-3"
          style={{ borderColor: 'var(--az-border)' }}
        >
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Steps</div>
            <button
              type="button"
              onClick={addStep}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs cursor-pointer"
              style={{ borderColor: 'var(--az-border)' }}
            >
              <Plus size={12} />
              Add Step
            </button>
          </div>

          {steps.map((step, idx) => (
            <div
              key={idx}
              className="p-3 rounded border space-y-2"
              style={{ borderColor: 'var(--az-border)', backgroundColor: 'rgba(255,255,255,0.03)' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-mono px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--az-border)', color: 'var(--az-fg)' }}
                >
                  {idx + 1}
                </span>
                <input
                  value={step.name}
                  onChange={(e) => updateStep(idx, { name: e.target.value })}
                  placeholder="Step name"
                  className="flex-1 px-2 py-1 rounded border bg-transparent text-xs outline-none"
                  style={{ borderColor: 'var(--az-border)' }}
                />
                <select
                  value={step.kind}
                  onChange={(e) =>
                    updateStep(idx, { kind: e.target.value as 'shell' | 'agent' })
                  }
                  className="px-2 py-1 rounded border text-xs"
                  style={{ borderColor: 'var(--az-border)', backgroundColor: 'var(--az-bg)' }}
                >
                  <option value="shell">Shell</option>
                  <option value="agent">Agent</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeStep(idx)}
                  disabled={steps.length === 1}
                  className="p-1 rounded border cursor-pointer disabled:opacity-30"
                  style={{ borderColor: 'var(--az-border)' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>

              <input
                value={step.commandOrPrompt}
                onChange={(e) => updateStep(idx, { commandOrPrompt: e.target.value })}
                placeholder={
                  step.kind === 'shell'
                    ? 'e.g. npm test -- --reporter=tap'
                    : 'e.g. Refactor auth module to use JWT'
                }
                className="w-full px-2 py-1 rounded border bg-transparent text-xs font-mono outline-none"
                style={{ borderColor: 'var(--az-border)' }}
              />

              <div className="flex items-center gap-2">
                <label className="text-xs opacity-70">Retries:</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={step.retries}
                  onChange={(e) => updateStep(idx, { retries: Number(e.target.value) })}
                  className="w-14 px-2 py-0.5 rounded border bg-transparent text-xs font-mono outline-none"
                  style={{ borderColor: 'var(--az-border)' }}
                />
              </div>
            </div>
          ))}
        </div>

        <button
          type="submit"
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-1.5 rounded text-xs font-semibold cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--az-accent)', color: 'var(--az-accent-fg)' }}
        >
          {isRunning ? <Loader size={13} className="animate-spin" /> : <Play size={13} />}
          {isRunning ? 'Running...' : 'Run Workflow'}
        </button>
      </form>

      {/* Run history */}
      {runs.length > 0 && (
        <div
          className="p-4 rounded border space-y-2"
          style={{ borderColor: 'var(--az-border)' }}
        >
          <div className="text-sm font-semibold">Run History</div>
          {runs.map((run) => (
            <div key={run.id} className="rounded border overflow-hidden" style={{ borderColor: 'var(--az-border)' }}>
              <button
                type="button"
                onClick={() => setExpandedRun((p) => (p === run.id ? null : run.id))}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono cursor-pointer"
                style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
              >
                <div className="flex items-center gap-2">
                  {run.running ? (
                    <Loader size={12} className="animate-spin" style={{ color: 'var(--az-accent)' }} />
                  ) : run.result?.status === 'done' ? (
                    <CircleCheck size={12} style={{ color: '#22C55E' }} />
                  ) : (
                    <CircleAlert size={12} style={{ color: '#EF4444' }} />
                  )}
                  <span className="font-semibold">{run.name}</span>
                  <span className="opacity-50">{new Date(run.startedAt).toLocaleTimeString()}</span>
                </div>
                {expandedRun === run.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>

              {expandedRun === run.id && (
                <div className="px-3 pb-3 pt-1 space-y-2">
                  {run.running && (
                    <div className="text-xs font-mono opacity-60">[START] Workflow running...</div>
                  )}
                  {run.result?.steps.map((s, i) => (
                    <div
                      key={i}
                      className="p-2 rounded text-xs font-mono space-y-0.5"
                      style={{
                        backgroundColor:
                          s.status === 'done'
                            ? 'rgba(34,197,94,0.07)'
                            : 'rgba(239,68,68,0.07)',
                        borderLeft: `2px solid ${s.status === 'done' ? '#22C55E' : '#EF4444'}`,
                      }}
                    >
                      <div className="flex items-center gap-1.5 font-semibold">
                        {s.status === 'done' ? (
                          <CircleCheck size={10} style={{ color: '#22C55E' }} />
                        ) : (
                          <CircleAlert size={10} style={{ color: '#EF4444' }} />
                        )}
                        {s.name}
                        {s.attempts > 1 && (
                          <span className="opacity-60">({s.attempts} attempts)</span>
                        )}
                      </div>
                      {s.output.trim() && (
                        <pre
                          className="whitespace-pre-wrap opacity-80 pl-4"
                          style={{ fontSize: '0.68rem' }}
                        >
                          {s.output.trim()}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
