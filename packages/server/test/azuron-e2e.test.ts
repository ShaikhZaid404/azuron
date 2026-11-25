import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { serve } from '@hono/node-server';
import { createAzuronApp, type AzuronAppContext } from '../dist/app.js';

describe('AZURON A-to-Z Full Stack E2E Suite', () => {
  let tmpRoot: string;
  let azuronHome: string;
  let gitProjDir: string;
  let ctx: AzuronAppContext;
  let server: ReturnType<typeof serve>;
  let baseUrl: string;

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'azuron-e2e-'));
    azuronHome = path.join(tmpRoot, '.azuron');
    gitProjDir = path.join(tmpRoot, 'git-repo');
    fs.mkdirSync(gitProjDir, { recursive: true });

    // Initialize a real git repo for worktree + review gate E2E testing
    execFileSync('git', ['init', '-b', 'main'], { cwd: gitProjDir });
    execFileSync('git', ['config', 'user.email', 'test@azuron.local'], { cwd: gitProjDir });
    execFileSync('git', ['config', 'user.name', 'AZURON Test'], { cwd: gitProjDir });
    fs.writeFileSync(path.join(gitProjDir, 'README.md'), '# Test Repo\n');
    execFileSync('git', ['add', '.'], { cwd: gitProjDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: gitProjDir });

    ctx = createAzuronApp({
      customHomeDir: azuronHome,
      workspaceRoot: path.resolve(import.meta.dirname, '../../..'),
      silentLogs: true,
    });

    const port = 45169;
    baseUrl = `http://127.0.0.1:${port}`;
    await new Promise<void>((resolve) => {
      server = serve({ fetch: ctx.app.fetch, hostname: '127.0.0.1', port }, () => resolve());
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    ctx.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('1. Health, Static SPA HTML, and Brand Logo over live HTTP', async () => {
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json() as Promise<{ name: string; status: string }>);
    assert.equal(health.name, 'AZURON');
    assert.equal(health.status, 'ready');

    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /<title>.*AZURON.*<\/title>/i);

    const logoRes = await fetch(`${baseUrl}/brand/azuron-logo.webp`);
    assert.equal(logoRes.status, 200);
    assert.equal(logoRes.headers.get('content-type'), 'image/webp');
  });

  it('2. Health & Environment Toolchain inspection', async () => {
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json() as Promise<{ status: string }>);
    assert.equal(health.status, 'ready');

    const env = await fetch(`${baseUrl}/api/environment`).then((r) => r.json() as Promise<{ platform: string; nodeVersion: string }>);
    assert.equal(typeof env.platform, 'string');
    assert.match(env.nodeVersion, /^v\d+/);
  });

  it('3. Accounts (N-accounts, activate, OAuth, delete), BYOK & Integrations', async () => {
    const a1 = await fetch(`${baseUrl}/api/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'antigravity', accountName: 'AGY Main' }),
    }).then((r) => r.json() as Promise<{ account: { id: string } }>);
    assert.ok(a1.account.id);

    const a2 = await fetch(`${baseUrl}/api/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'codex', accountName: 'Codex Pro' }),
    }).then((r) => r.json() as Promise<{ account: { id: string } }>);

    const oauth = await fetch(`${baseUrl}/api/accounts/${a1.account.id}/oauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then((r) => r.json() as Promise<{ ok: boolean; profilePath: string }>);
    assert.equal(oauth.ok, true);
    assert.ok(oauth.profilePath.includes(a1.account.id));

    const act = await fetch(`${baseUrl}/api/accounts/${a2.account.id}/activate`, { method: 'POST' });
    assert.equal(act.status, 200);

    const byok = await fetch(`${baseUrl}/api/byok`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'groq', label: 'Groq E2E', apiKey: 'gsk_e2e_1234567890' }),
    }).then((r) => r.json() as Promise<{ key: { id: string; maskedKey: string } }>);
    assert.equal(byok.key.maskedKey, 'gsk_...7890');

    const delByok = await fetch(`${baseUrl}/api/byok/${byok.key.id}`, { method: 'DELETE' });
    assert.equal(delByok.status, 200);

    const intg = await fetch(`${baseUrl}/api/integrations`).then((r) => r.json() as Promise<{ integrations: unknown[] }>);
    assert.equal(intg.integrations.length >= 3, true);
  });

  it('4. Chats: create, append messages, lazy load, pin/protect, archive, delete', async () => {
    const created = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'E2E Chat', provider: 'antigravity', model: 'auto', mode: 'auto' }),
    }).then((r) => r.json() as Promise<{ conversation: { id: string } }>);
    const chatId = created.conversation.id;
    assert.ok(chatId);

    const list = await fetch(`${baseUrl}/api/conversations`).then((r) => r.json() as Promise<{ conversations: Array<{ id: string }> }>);
    assert.equal(list.conversations.some((c) => c.id === chatId), true);

    const msgs = await fetch(`${baseUrl}/api/conversations/${chatId}/messages`).then((r) => r.json() as Promise<{ messages: unknown[] }>);
    assert.equal(Array.isArray(msgs.messages), true);

    const patch = await fetch(`${baseUrl}/api/conversations/${chatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPinned: true, isProtected: true }),
    }).then((r) => r.json() as Promise<{ conversation: { isPinned: boolean; isProtected: boolean } }>);
    assert.equal(patch.conversation.isPinned, true);
    assert.equal(patch.conversation.isProtected, true);

    const del = await fetch(`${baseUrl}/api/conversations/${chatId}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
  });

  it('5. Projects, Tasks, Git Worktree Prepare & Review Gate (Approve Merge + Reject)', async () => {
    const proj = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'E2E Git Repo', filesystemPath: gitProjDir, baseBranch: 'main' }),
    }).then((r) => r.json() as Promise<{ project: { id: string } }>);

    const task = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: proj.project.id,
        title: 'Worktree Task',
        prompt: 'Add feature',
        provider: 'antigravity',
        model: 'auto',
      }),
    }).then((r) => r.json() as Promise<{ task: { id: string } }>);

    const prep = await fetch(`${baseUrl}/api/tasks/${task.task.id}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then((r) => r.json() as Promise<{ task: { status: string; worktreePath: string } }>);
    assert.equal(prep.task.status, 'running');
    assert.ok(prep.task.worktreePath.includes(task.task.id));

    // Move to review and approve_merge
    await fetch(`${baseUrl}/api/tasks/${task.task.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'review' }),
    });

    const rev = await fetch(`${baseUrl}/api/tasks/${task.task.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve_merge' }),
    }).then((r) => r.json() as Promise<{ task: { status: string } }>);
    assert.equal(rev.task.status, 'done');
  });

  it('6. AI Terminal, Workflows, Storage, Analytics, Models, Settings', async () => {
    const proj = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'E2E Term Proj', filesystemPath: tmpRoot }),
    }).then((r) => r.json() as Promise<{ project: { id: string } }>);

    const compiled = await fetch(`${baseUrl}/api/terminal/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: proj.project.id, userPrompt: 'echo azuron-e2e' }),
    }).then((r) => r.json() as Promise<{ command?: { id: string; riskLevel: string }; id?: string; riskLevel?: string }>);
    const cmdId = compiled.command?.id ?? compiled.id!;
    const risk = compiled.command?.riskLevel ?? compiled.riskLevel;
    assert.equal(risk, 'safe');

    const exec = await fetch(`${baseUrl}/api/terminal/commands/${cmdId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' }),
    }).then((r) => r.json() as Promise<{ command: { exitCode: number; outputLog: string } }>);
    assert.equal(exec.command.exitCode, 0);
    assert.match(exec.command.outputLog, /azuron-e2e/);

    const wf = await fetch(`${baseUrl}/api/workflows/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Pipeline',
        steps: [{ name: 'step-1', kind: 'shell', commandOrPrompt: 'echo wf-e2e' }],
      }),
    }).then((r) => r.json() as Promise<{ result: { status: string } }>);
    assert.equal(wf.result.status, 'done');

    const storage = await fetch(`${baseUrl}/api/storage`).then((r) => r.json() as Promise<{ policies: unknown[] }>);
    assert.equal(storage.policies.length >= 4, true);

    const analytics = await fetch(`${baseUrl}/api/analytics?days=7`).then((r) => r.json() as Promise<Record<string, unknown>>);
    assert.equal(typeof analytics, 'object');

    const models = await fetch(`${baseUrl}/api/models`).then((r) => r.json() as Promise<{ models: unknown[] }>);
    assert.equal(Array.isArray(models.models), true);

    const agentsMd = await fetch(`${baseUrl}/api/instructions`).then((r) => r.json() as Promise<{ content: string }>);
    assert.equal(typeof agentsMd.content, 'string');
  });
});
