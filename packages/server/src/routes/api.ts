import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  ApproveTerminalRequestSchema,
  CompileTerminalRequestSchema,
  ConnectIntegrationSchema,
  CreateAccountSchema,
  CreateByokKeySchema,
  CreateConversationSchema,
  CreateProjectSchema,
  CreateTaskSchema,
  RetentionCategorySchema,
  SendMessageSchema,
  TaskStatusSchema,
  UpdateConversationSchema,
} from '@azuron/contract';
import type { AzuronEnvironmentInspector } from '../core/environment.js';
import type { AzuronLogger } from '../core/logger.js';
import { launchProviderOAuth, syncAccountEmailFromProfile } from '../core/oauth.js';
import type { AzuronPaths } from '../core/paths.js';
import type { AzuronStreamHub } from '../core/stream-hub.js';
import type { AzuronAccountVault } from '../core/vault.js';
import type { AzuronAiTerminal } from '../services/ai-terminal.js';
import type { AzuronAnalyticsService } from '../services/analytics.js';
import type { AzuronChatManager } from '../services/chat-manager.js';
import type { AzuronCloudBackupService } from '../services/cloud-backup.js';
import type { AzuronModelCenter } from '../services/model-center.js';
import type { AzuronStorageRetentionEngine } from '../services/storage-retention.js';
import type { AzuronTaskManager } from '../services/task-manager.js';
import type { AzuronWorkflowEngine } from '../services/workflow-engine.js';

export interface AzuronServices {
  paths: AzuronPaths;
  logger: AzuronLogger;
  hub: AzuronStreamHub;
  vault: AzuronAccountVault;
  env: AzuronEnvironmentInspector;
  chats: AzuronChatManager;
  models: AzuronModelCenter;
  terminal: AzuronAiTerminal;
  storage: AzuronStorageRetentionEngine;
  analytics: AzuronAnalyticsService;
  tasks: AzuronTaskManager;
  workflows: AzuronWorkflowEngine;
  backup: AzuronCloudBackupService;
  startedAt: number;
  workspaceRoot: string;
}

export function createApiRouter(svc: AzuronServices): Hono {
  const api = new Hono();

  api.get('/health', async (c) => {
    const mem = process.memoryUsage();
    const toolchain = await svc.env.inspect();
    return c.json({
      name: 'AZURON',
      status: 'ready',
      uptimeSec: Math.floor((Date.now() - svc.startedAt) / 1000),
      memoryMb: Math.round(mem.rss / (1024 * 1024)),
      heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      activeRuns: svc.hub.getActiveRuns(),
      toolchain,
    });
  });

  // Zero-Loss Singleton SSE Endpoint with Last-Event-ID SQLite Replay
  api.get('/stream', (c) => {
    const headerId = c.req.header('Last-Event-ID');
    const queryId = c.req.query('lastEventId');
    const lastEventId = Number(headerId ?? queryId ?? 0);

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        id: '0',
        event: 'hub.connected',
        data: JSON.stringify({
          activeRuns: svc.hub.getActiveRuns(),
          timestamp: Date.now(),
        }),
      });

      if (Number.isFinite(lastEventId) && lastEventId > 0) {
        const missed = svc.hub.replaySince(lastEventId);
        for (const ev of missed) {
          await stream.writeSSE({
            id: String(ev.id),
            event: ev.type,
            data: JSON.stringify(ev),
          });
        }
      }

      let closed = false;
      const unsubscribe = svc.hub.subscribe((ev) => {
        if (closed) return;
        void stream.writeSSE({
          id: String(ev.id),
          event: ev.type,
          data: JSON.stringify(ev),
        });
      });

      const keepAlive = setInterval(() => {
        if (!closed) {
          void stream.write(': keepalive\n\n');
        }
      }, 15_000);

      stream.onAbort(() => {
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
      });

      while (!closed) {
        await stream.sleep(1000);
      }
    });
  });

  // Environment & Integrations
  api.get('/environment', async (c) => {
    return c.json(await svc.env.inspect());
  });

  api.get('/integrations', async (c) => {
    return c.json({ integrations: await svc.env.getIntegrationStatuses(svc.vault) });
  });

  api.post('/integrations', async (c) => {
    const parsed = ConnectIntegrationSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    svc.vault.saveIntegrationToken(
      parsed.data.name,
      parsed.data.token,
      parsed.data.accountLabel,
      'Saved via Web Connectors Hub',
    );
    return c.json({ ok: true, integrations: await svc.env.getIntegrationStatuses(svc.vault) });
  });

  // Native CLI Accounts (N-accounts per provider)
  api.get('/accounts', (c) => {
    return c.json({ accounts: svc.vault.listAccounts() });
  });

  api.post('/accounts', async (c) => {
    const parsed = CreateAccountSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const account = svc.vault.createAccount(parsed.data.provider, parsed.data.accountName);
    svc.logger.log('INFO', `Created ${account.provider} profile`, {
      accountId: account.id,
      profilePath: account.authProfilePath,
    });
    return c.json({ account }, 201);
  });

  api.post('/accounts/:id/activate', (c) => {
    try {
      const account = svc.vault.activateAccount(c.req.param('id'));
      return c.json({ account });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Activation failed' }, 404);
    }
  });

  api.delete('/accounts/:id', (c) => {
    const ok = svc.vault.deleteAccount(c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'Account not found' }, 404);
  });

  // BYOK API Keys
  api.get('/byok', (c) => {
    return c.json({ keys: svc.vault.listByokKeys() });
  });

  api.post('/byok', async (c) => {
    const parsed = CreateByokKeySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const key = svc.vault.addByokKey(parsed.data.provider, parsed.data.label, parsed.data.apiKey);
    return c.json({ key }, 201);
  });

  api.delete('/byok/:id', (c) => {
    const ok = svc.vault.deleteByokKey(c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'Key not found' }, 404);
  });

  // Model Center
  api.get('/models', async (c) => {
    const refresh = c.req.query('refresh') === '1';
    return c.json(await svc.models.listModels(refresh));
  });

  // Projects
  api.get('/projects', (c) => {
    return c.json({ projects: svc.tasks.listProjects() });
  });

  api.post('/projects', async (c) => {
    const parsed = CreateProjectSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      const project = svc.tasks.createProject(parsed.data);
      return c.json({ project }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to create project' }, 400);
    }
  });

  api.delete('/projects/:id', (c) => {
    const ok = svc.tasks.deleteProject(c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'Project not found' }, 404);
  });

  api.get('/projects/:id/git', async (c) => {
    try {
      return c.json(await svc.tasks.getProjectGitStatus(c.req.param('id')));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Not found' }, 404);
    }
  });

  // Persistent Conversations (100% AZURON-Owned)
  api.get('/conversations', (c) => {
    const projectId = c.req.query('projectId') || undefined;
    const includeArchived = c.req.query('includeArchived') === '1';
    const search = c.req.query('q') || undefined;
    return c.json({
      conversations: svc.chats.listConversations({ projectId, includeArchived, search }),
    });
  });

  api.post('/conversations', async (c) => {
    const parsed = CreateConversationSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const conversation = svc.chats.createConversation(parsed.data);
    return c.json({ conversation }, 201);
  });

  api.patch('/conversations/:id', async (c) => {
    const parsed = UpdateConversationSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const updated = svc.chats.updateConversation(c.req.param('id'), parsed.data);
    return updated ? c.json({ conversation: updated }) : c.json({ error: 'Not found' }, 404);
  });

  api.delete('/conversations/:id', (c) => {
    const ok = svc.chats.deleteConversation(c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
  });

  api.get('/conversations/:id/messages', (c) => {
    const limit = Number(c.req.query('limit') ?? 30);
    const before = c.req.query('before') ? Number(c.req.query('before')) : undefined;
    return c.json({
      messages: svc.chats.listMessages(c.req.param('id'), { limit, beforeCreatedAt: before }),
    });
  });

  api.post('/conversations/:id/messages', async (c) => {
    const parsed = SendMessageSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      svc.logger.log('TURN', `Dispatching chat turn`, { conversationId: c.req.param('id') });
      const res = await svc.chats.sendMessageAndExecute(c.req.param('id'), parsed.data);
      return c.json(res, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Execution failed' }, 400);
    }
  });

  // Tasks
  api.get('/tasks', (c) => {
    return c.json({ tasks: svc.tasks.listTasks(c.req.query('projectId') || undefined) });
  });

  api.post('/tasks', async (c) => {
    const parsed = CreateTaskSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      const task = svc.tasks.createTask(parsed.data);
      svc.logger.log('START', `Queued task ${task.title}`, { taskId: task.id });
      return c.json({ task }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to create task' }, 400);
    }
  });

  api.patch('/tasks/:id/status', async (c) => {
    const body = (await c.req.json()) as { status?: unknown; diffStat?: string };
    const statusParsed = TaskStatusSchema.safeParse(body.status);
    if (!statusParsed.success) {
      return c.json({ error: 'Invalid status' }, 400);
    }
    const task = svc.tasks.updateTaskStatus(c.req.param('id'), statusParsed.data, body.diffStat);
    return task ? c.json({ task }) : c.json({ error: 'Task not found' }, 404);
  });

  api.patch('/tasks/:id/protect', async (c) => {
    const body = (await c.req.json()) as { isProtected?: boolean };
    const task = svc.tasks.setTaskProtected(c.req.param('id'), Boolean(body.isProtected));
    return task ? c.json({ task }) : c.json({ error: 'Task not found' }, 404);
  });

  // AI-Assisted Terminal & Safety Referee
  api.get('/terminal/commands', (c) => {
    return c.json({
      commands: svc.terminal.listCommands(c.req.query('projectId') || undefined),
    });
  });

  api.post('/terminal/compile', async (c) => {
    const parsed = CompileTerminalRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const command = svc.terminal.compile(parsed.data.projectId, parsed.data.userPrompt);
    svc.logger.log('CHECK', `Compiled terminal command (${command.riskLevel})`, {
      id: command.id,
      command: command.compiledCommand,
    });
    return c.json({ command }, 201);
  });

  api.post('/terminal/commands/:id/decide', async (c) => {
    const parsed = ApproveTerminalRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      const command = await svc.terminal.decideAndExecute(
        c.req.param('id'),
        parsed.data.decision,
        parsed.data.confirmationText,
      );
      return c.json({ command });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Terminal decision failed' }, 400);
    }
  });

  // Smart Storage Retention Engine
  api.get('/storage', (c) => {
    return c.json({
      breakdown: svc.storage.getStorageBreakdown(),
      policies: svc.storage.listPolicies(),
    });
  });

  api.patch('/storage/policies/:category', async (c) => {
    const cat = RetentionCategorySchema.safeParse(c.req.param('category'));
    if (!cat.success) {
      return c.json({ error: 'Invalid retention category' }, 400);
    }
    const body = (await c.req.json()) as { retentionDays?: number; isEnabled?: boolean };
    if (typeof body.retentionDays !== 'number' || body.retentionDays < 1) {
      return c.json({ error: 'retentionDays must be >= 1' }, 400);
    }
    const policy = svc.storage.updatePolicy(
      cat.data,
      Math.floor(body.retentionDays),
      body.isEnabled ?? true,
    );
    return c.json({ policy });
  });

  api.post('/storage/cleanup', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { dryRun?: boolean };
    const report = svc.storage.runCleanup({ dryRun: Boolean(body.dryRun) });
    return c.json({ report });
  });

  // Usage Analytics & Contribution Heatmap
  api.get('/analytics', (c) => {
    const days = Number(c.req.query('days') ?? 365);
    const accountsParam = c.req.query('accounts');
    const accountIds = accountsParam
      ? accountsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    return c.json(svc.analytics.getSummary({ days: Number.isFinite(days) ? days : 365, accountIds }));
  });

  // Self-Refining AGENTS.md Viewer & Editor
  api.get('/instructions', (c) => {
    const agentsPath = path.join(svc.workspaceRoot, 'AGENTS.md');
    const content = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
    return c.json({ path: agentsPath, content });
  });

  api.put('/instructions', async (c) => {
    const body = (await c.req.json()) as { content?: string };
    if (typeof body.content !== 'string') {
      return c.json({ error: 'content string required' }, 400);
    }
    const agentsPath = path.join(svc.workspaceRoot, 'AGENTS.md');
    fs.writeFileSync(agentsPath, body.content, 'utf8');
    return c.json({ ok: true, path: agentsPath });
  });

  // Live Marketplace (Zero Hardcoded Catalog — Live GitHub Discovery)
  api.get('/marketplace', async (c) => {
    const q = (c.req.query('q') || 'agent skill react component').trim();
    const category = c.req.query('category') || 'all';
    const topicFilter =
      category === 'skills'
        ? `${q} SKILL.md OR agent-skills`
        : category === 'components'
          ? `${q} react component tailwind`
          : category === 'workflows'
            ? `${q} github actions OR workflow`
            : q;

    try {
      const ghToken = svc.vault.getIntegrationToken('github').token;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'AZURON-Workspace',
      };
      if (ghToken) {
        headers.Authorization = `Bearer ${ghToken}`;
      }

      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(topicFilter)}&sort=stars&order=desc&per_page=15`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        return c.json({ items: [], source: 'github', warning: `GitHub returned ${res.status}` });
      }
      const json = (await res.json()) as {
        items?: Array<{
          id: number;
          full_name: string;
          name: string;
          description: string | null;
          html_url: string;
          stargazers_count: number;
          language: string | null;
          updated_at: string;
          owner?: { avatar_url?: string; login?: string };
        }>;
      };
      const items = (json.items ?? []).map((repo) => ({
        id: String(repo.id),
        title: repo.full_name,
        name: repo.name,
        description: repo.description ?? 'No description provided.',
        url: repo.html_url,
        stars: repo.stargazers_count,
        language: repo.language,
        author: repo.owner?.login ?? 'unknown',
        avatarUrl: repo.owner?.avatar_url ?? null,
        updatedAt: repo.updated_at,
      }));
      return c.json({ items, source: 'github' });
    } catch (err) {
      return c.json({
        items: [],
        source: 'github',
        warning: err instanceof Error ? err.message : 'Marketplace offline',
      });
    }
  });

  // Phase 2: 1-Click Browser OAuth Launcher
  api.post('/accounts/:id/oauth', async (c) => {
    const account = svc.vault.getAccount(c.req.param('id'));
    if (!account) {
      return c.json({ error: 'Account not found' }, 404);
    }
    const result = await launchProviderOAuth(account, svc.vault, svc.hub);
    return c.json(result);
  });

  api.post('/accounts/:id/sync-email', async (c) => {
    const account = svc.vault.getAccount(c.req.param('id'));
    if (!account) {
      return c.json({ error: 'Account not found' }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    if (body.email && body.email.includes('@')) {
      const updated = svc.vault.updateAccountEmail(account.id, body.email.trim());
      return c.json({ account: updated });
    }
    syncAccountEmailFromProfile(account, svc.vault);
    return c.json({ account: svc.vault.getAccount(account.id) });
  });

  // Phase 2: Task Worktree Prepare & Review Gate
  api.post('/tasks/:id/prepare', async (c) => {
    try {
      const task = await svc.tasks.prepareWorktree(c.req.param('id'));
      return c.json({ task });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to prepare worktree' }, 400);
    }
  });

  api.post('/tasks/:id/review', async (c) => {
    const body = (await c.req.json()) as { decision?: 'approve_merge' | 'reject' };
    if (body.decision !== 'approve_merge' && body.decision !== 'reject') {
      return c.json({ error: 'decision must be approve_merge or reject' }, 400);
    }
    try {
      const task = await svc.tasks.reviewTask(c.req.param('id'), body.decision);
      return c.json({ task });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Review failed' }, 400);
    }
  });

  // Phase 2: Multi-Step Workflow Runner
  api.post('/workflows/run', async (c) => {
    const body = (await c.req.json()) as {
      name?: string;
      cwd?: string;
      steps?: Array<{ name: string; kind: 'shell' | 'agent'; commandOrPrompt: string; retries?: number }>;
    };
    if (!body.name || !Array.isArray(body.steps) || body.steps.length === 0) {
      return c.json({ error: 'name and non-empty steps array required' }, 400);
    }
    const result = await svc.workflows.runWorkflow(
      body.name,
      body.cwd || svc.workspaceRoot,
      body.steps,
    );
    return c.json({ result });
  });

  // Phase 2: Cloud Backup via rclone
  api.post('/storage/backup', async (c) => {
    const body = (await c.req.json()) as {
      remoteName?: string;
      projectId?: string;
    };
    const remoteName = body.remoteName?.trim() || 'gdrive';
    if (body.projectId) {
      const project = svc.tasks.getProject(body.projectId);
      if (!project) return c.json({ error: 'Project not found' }, 404);
      const res = await svc.backup.backupPath(project.filesystemPath, remoteName, `projects/${project.name}`);
      return c.json(res, res.ok ? 200 : 500);
    }
    const res = await svc.backup.backupFullAzuron(remoteName);
    return c.json(res, res.ok ? 200 : 500);
  });

  return api;
}
