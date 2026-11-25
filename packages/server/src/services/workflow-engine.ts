import { spawn } from 'node:child_process';
import type { AzuronStreamHub } from '../core/stream-hub.js';

export interface WorkflowStep {
  name: string;
  kind: 'shell' | 'agent';
  commandOrPrompt: string;
  retries?: number;
}

export interface WorkflowRunResult {
  workflowName: string;
  status: 'done' | 'failed';
  steps: Array<{
    name: string;
    status: 'done' | 'failed';
    attempts: number;
    output: string;
  }>;
}

export class AzuronWorkflowEngine {
  private readonly hub: AzuronStreamHub;

  constructor(hub: AzuronStreamHub) {
    this.hub = hub;
  }

  public async runWorkflow(
    workflowName: string,
    cwd: string,
    steps: WorkflowStep[],
  ): Promise<WorkflowRunResult> {
    const runId = `wf_${Date.now()}`;
    this.hub.setActiveRun({
      id: runId,
      kind: 'task',
      title: `Workflow: ${workflowName}`,
      step: 'Starting',
      startedAt: Date.now(),
    });

    const results: WorkflowRunResult['steps'] = [];
    let overallStatus: 'done' | 'failed' = 'done';

    for (const step of steps) {
      const maxAttempts = Math.max(1, (step.retries ?? 0) + 1);
      let attempt = 0;
      let stepOk = false;
      let lastOutput = '';

      this.hub.updateActiveRunStep(runId, step.name);

      while (attempt < maxAttempts && !stepOk) {
        attempt += 1;
        this.hub.emit('task', runId, 'task.log', {
          message: `[START] Step "${step.name}" (attempt ${attempt}/${maxAttempts})`,
        });

        if (step.kind === 'shell') {
          const res = await this.execShell(step.commandOrPrompt, cwd);
          lastOutput = res.output;
          stepOk = res.exitCode === 0;
        } else {
          lastOutput = `[INFO] Agent step queued: ${step.commandOrPrompt}`;
          stepOk = true;
        }
      }

      results.push({
        name: step.name,
        status: stepOk ? 'done' : 'failed',
        attempts: attempt,
        output: lastOutput,
      });

      if (!stepOk) {
        overallStatus = 'failed';
        this.hub.emit('task', runId, 'task.log', {
          message: `[ERROR] Step "${step.name}" failed after ${attempt} attempt(s)`,
        });
        break;
      }
    }

    this.hub.clearActiveRun(runId);
    return { workflowName, status: overallStatus, steps: results };
  }

  private execShell(command: string, cwd: string): Promise<{ exitCode: number; output: string }> {
    const shellBin = process.env.SHELL || '/bin/sh';
    return new Promise((resolve) => {
      const child = spawn(shellBin, ['-c', command], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (d: Buffer) => {
        output += d.toString('utf8');
      });
      child.stderr.on('data', (d: Buffer) => {
        output += d.toString('utf8');
      });
      child.on('error', (err) => resolve({ exitCode: 1, output: err.message }));
      child.on('close', (code) => resolve({ exitCode: code ?? 1, output }));
    });
  }
}
