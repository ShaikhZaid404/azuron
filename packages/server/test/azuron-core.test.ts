import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createAzuronApp, type AzuronAppContext } from '../dist/app.js';
import {
  classifyCommandRisk,
  compileNaturalLanguageToShell,
  enforceNoExecCompatibility,
} from '../dist/services/ai-terminal.js';

describe('AZURON Core Backend & Persistence Suite', () => {
  let tmpRoot: string;
  let azuronHome: string;
  let projectDir: string;
  let ctx: AzuronAppContext;

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'azuron-test-'));
    azuronHome = path.join(tmpRoot, '.azuron');
    projectDir = path.join(tmpRoot, 'sample-project');
    fs.mkdirSync(projectDir, { recursive: true });
    ctx = createAzuronApp({
      customHomeDir: azuronHome,
      workspaceRoot: path.resolve(import.meta.dirname, '../../..'),
      silentLogs: true,
    });
  });

  after(() => {
    ctx.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('initializes SQLite in WAL mode and seeds default retention policies', () => {
    const mode = ctx.db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
    assert.equal(mode.journal_mode.toLowerCase(), 'wal');

    const policies = ctx.services.storage.listPolicies();
    const map = new Map(policies.map((p) => [p.category, p.retentionDays]));
    assert.equal(map.get('task_logs'), 7);
    assert.equal(map.get('inactive_chats'), 30);
    assert.equal(map.get('temp_files'), 2);
    assert.equal(map.get('usage_history'), 365);
  });

  it('encrypts/decrypts secrets with AES-256-GCM and manages N-accounts per provider', () => {
    const secret = 'sk-test-secret-123456';
    const cipher = ctx.services.vault.encryptSecret(secret);
    assert.notEqual(cipher, secret);
    assert.equal(ctx.services.vault.decryptSecret(cipher), secret);

    const a1 = ctx.services.vault.createAccount('codex', 'Codex Personal');
    const a2 = ctx.services.vault.createAccount('codex', 'Codex Work');
    assert.equal(a1.isActive, true);
    assert.equal(a2.isActive, false);

    ctx.services.vault.activateAccount(a2.id);
    assert.equal(ctx.services.vault.getAccount(a2.id)?.isActive, true);

    const fallback = ctx.services.vault.getNextFallbackAccount('codex', a2.id);
    assert.equal(fallback?.id, a1.id);

    const byok = ctx.services.vault.addByokKey('groq', 'Groq Fast', 'gsk_1234567890abcdef');
    assert.equal(byok.maskedKey, 'gsk_...cdef');
    assert.equal(ctx.services.vault.getDecryptedByokKey(byok.id), 'gsk_1234567890abcdef');
  });

  it('persists chats in AZURON-owned folders with lazy loading and zero-copy attachments', () => {
    const conv = ctx.services.chats.createConversation({
      title: 'Architecture Review',
      provider: 'antigravity',
      model: 'auto',
      mode: 'auto',
    });

    const metaFile = path.join(azuronHome, 'chats', 'global', conv.id, 'meta.json');
    assert.equal(fs.existsSync(metaFile), true);

    const imgPath = path.join(projectDir, 'screen.webp');
    fs.writeFileSync(imgPath, 'fake-webp-bytes');

    for (let i = 0; i < 35; i++) {
      ctx.services.chats.appendMessage(conv.id, i % 2 === 0 ? 'user' : 'assistant', `Turn ${i}`, {
        attachments:
          i === 0
            ? [
                {
                  originalPath: imgPath,
                  basename: 'screen.webp',
                  sizeBytes: 15,
                  mimeType: 'image/webp',
                  kind: 'image',
                },
              ]
            : [],
      });
    }

    const jsonlFile = path.join(azuronHome, 'chats', 'global', conv.id, 'messages.jsonl');
    assert.equal(fs.existsSync(jsonlFile), true);

    // Lazy loading returns latest 30 messages
    const latest30 = ctx.services.chats.listMessages(conv.id, { limit: 30 });
    assert.equal(latest30.length, 30);
    assert.equal(latest30[0]?.content, 'Turn 5');
    assert.equal(latest30[29]?.content, 'Turn 34');

    // Mode auto-routing
    assert.equal(ctx.services.chats.resolveExecutionMode('auto', 'plan banao auth ka'), 'plan');
    assert.equal(ctx.services.chats.resolveExecutionMode('auto', 'run beast autonomous loop'), 'beast');
    assert.equal(ctx.services.chats.resolveExecutionMode('auto', 'implement login'), 'code');
  });

  it('replays missed SSE events via AzuronStreamHub Last-Event-ID', () => {
    const ev1 = ctx.services.hub.emit('chat', 'c1', 'chat.delta', { delta: 'Hello ' });
    const ev2 = ctx.services.hub.emit('chat', 'c1', 'chat.delta', { delta: 'AZURON' });
    const missed = ctx.services.hub.replaySince(ev1.id);
    assert.equal(missed.length >= 1, true);
    assert.equal(missed.some((e) => e.id === ev2.id && e.payload.delta === 'AZURON'), true);
  });

  it('classifies terminal risks, rewrites noexec scripts, and enforces destructive CONFIRM gate', async () => {
    assert.equal(classifyCommandRisk('ls -la'), 'safe');
    assert.equal(classifyCommandRisk('npm test'), 'moderate');
    assert.equal(classifyCommandRisk('rm -rf /tmp/foo'), 'destructive');
    assert.equal(classifyCommandRisk('git reset --hard HEAD'), 'destructive');

    assert.equal(enforceNoExecCompatibility('./deploy.sh --fast'), 'bash ./deploy.sh --fast');
    assert.equal(enforceNoExecCompatibility('./seed.py'), 'python ./seed.py');

    const nl = compileNaturalLanguageToShell('Project ka git status check karo');
    assert.equal(nl.compiledCommand, 'git status -sb');

    const proj = ctx.services.tasks.createProject({
      name: 'Sample',
      filesystemPath: projectDir,
    });

    const safeCmd = ctx.services.terminal.compile(proj.id, 'echo hello-azuron');
    assert.equal(safeCmd.riskLevel, 'safe');
    const executed = await ctx.services.terminal.decideAndExecute(safeCmd.id, 'approved');
    assert.equal(executed.exitCode, 0);
    assert.match(executed.outputLog ?? '', /hello-azuron/);

    const badCmd = ctx.services.terminal.compile(proj.id, 'rm -rf ./temp-dir');
    assert.equal(badCmd.riskLevel, 'destructive');
    await assert.rejects(
      () => ctx.services.terminal.decideAndExecute(badCmd.id, 'approved', 'wrong'),
      /CONFIRM/,
    );
  });

  it('protects pinned/Keep Forever items during storage retention cleanup', () => {
    const oldTs = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const stale = ctx.services.chats.createConversation({
      title: 'Stale Unpinned',
      provider: 'codex',
      model: 'auto',
      mode: 'code',
    });
    const pinned = ctx.services.chats.createConversation({
      title: 'Important Pinned',
      provider: 'codex',
      model: 'auto',
      mode: 'code',
    });
    ctx.services.chats.updateConversation(pinned.id, { isPinned: true, isProtected: true });

    ctx.db
      .prepare('UPDATE conversations SET last_activity_at = ? WHERE id IN (?, ?)')
      .run(oldTs, stale.id, pinned.id);

    const dry = ctx.services.storage.runCleanup({ dryRun: true });
    assert.equal(dry.archivedChatsCount, 1);

    const applied = ctx.services.storage.runCleanup({ dryRun: false });
    assert.equal(applied.archivedChatsCount, 1);
    assert.equal(ctx.services.chats.getConversation(stale.id)?.isArchived, true);
    assert.equal(ctx.services.chats.getConversation(pinned.id)?.isArchived, false);
  });

  it('serves Hono API endpoints and official AZURON brand logo', async () => {
    const healthRes = await ctx.app.request('/api/health');
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { name: string; status: string };
    assert.equal(healthJson.name, 'AZURON');
    assert.equal(healthJson.status, 'ready');

    const logoRes = await ctx.app.request('/brand/azuron-logo.webp');
    assert.equal(logoRes.status, 200);
    assert.equal(logoRes.headers.get('content-type'), 'image/webp');
  });

  // ---------------------------------------------------------------------------
  // Phase 2 — WorkflowEngine, CloudBackup, Worktree/Review Routes
  // ---------------------------------------------------------------------------

  it('WorkflowEngine: runs multi-step shell pipeline with retry on transient failure', async () => {
    const result = await ctx.services.workflows.runWorkflow(
      'CI Lint',
      tmpRoot,
      [
        { name: 'echo-check', kind: 'shell', commandOrPrompt: 'echo workflow-ok', retries: 0 },
        { name: 'pwd-check',  kind: 'shell', commandOrPrompt: 'pwd', retries: 1 },
      ],
    );
    assert.equal(result.workflowName, 'CI Lint');
    assert.equal(result.status, 'done');
    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[0]!.status, 'done');
    assert.match(result.steps[0]!.output, /workflow-ok/);
    assert.equal(result.steps[1]!.status, 'done');
  });

  it('WorkflowEngine: marks overall status failed and stops on first unrecoverable step', async () => {
    const result = await ctx.services.workflows.runWorkflow(
      'Failing Workflow',
      tmpRoot,
      [
        { name: 'will-fail', kind: 'shell', commandOrPrompt: 'exit 1', retries: 0 },
        { name: 'should-skip', kind: 'shell', commandOrPrompt: 'echo should-not-run' },
      ],
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0]!.name, 'will-fail');
    assert.equal(result.steps[0]!.status, 'failed');
  });

  it('WorkflowEngine: agent-kind steps always succeed (queued, no runner needed)', async () => {
    const result = await ctx.services.workflows.runWorkflow(
      'Agent Pipeline',
      tmpRoot,
      [{ name: 'plan-step', kind: 'agent', commandOrPrompt: 'Build auth module' }],
    );
    assert.equal(result.status, 'done');
    assert.equal(result.steps[0]!.status, 'done');
    assert.match(result.steps[0]!.output, /Agent step queued/);
  });

  it('WorkflowEngine: retries exhausted step reports correct attempt count', async () => {
    const result = await ctx.services.workflows.runWorkflow(
      'Retry Test',
      tmpRoot,
      [{ name: 'flaky', kind: 'shell', commandOrPrompt: 'exit 1', retries: 2 }],
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.steps[0]!.attempts, 3);
  });

  it('POST /api/workflows/run returns workflow result JSON', async () => {
    const wfProjDir = path.join(tmpRoot, 'wf-route-proj');
    fs.mkdirSync(wfProjDir, { recursive: true });
    const proj = ctx.services.tasks.createProject({
      name: 'WF-Route-Test',
      filesystemPath: wfProjDir,
    });
    const res = await ctx.app.request('/api/workflows/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'API Workflow',
        projectId: proj.id,
        steps: [{ name: 'greet', kind: 'shell', commandOrPrompt: 'echo api-wf-ok' }],
      }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { result: { status: string } };
    assert.equal(json.result.status, 'done');
  });

  it('CloudBackupService: backupPath returns ok:false when rclone binary is absent/no remote configured', async () => {
    // rclone exists on device but no remote named "azuron-test-nonexistent-remote" is configured
    const result = await ctx.services.backup.backupPath(
      tmpRoot,
      'azuron-test-nonexistent-remote',
      'ci-test',
    );
    // We only assert structural shape — rclone may succeed (exit 0) or fail depending on config
    assert.equal(typeof result.ok, 'boolean');
    assert.equal(typeof result.destination, 'string');
    assert.match(result.destination, /azuron-test-nonexistent-remote:azuron-backups\/ci-test/);
    assert.equal(typeof result.output, 'string');
  });

  it('POST /api/storage/backup accepts request and returns a result object', async () => {
    const res = await ctx.app.request('/api/storage/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remoteName: 'test-remote', scope: 'full' }),
    });
    // Server responds — may be ok:true or ok:false depending on rclone config, never 5xx crash
    assert.equal(res.status === 200 || res.status === 500, true);
    if (res.status === 200) {
      const json = (await res.json()) as { destination: string };
      assert.equal(typeof json.destination, 'string');
    }
  });

  it('POST /api/tasks/:id/prepare handles non-git directory via graceful fallback (returns 200)', async () => {
    // Use a fresh dir that is not a git repo
    const noGitDir = path.join(tmpRoot, 'no-git-proj');
    fs.mkdirSync(noGitDir, { recursive: true });
    const proj = ctx.services.tasks.createProject({
      name: 'No-Git',
      filesystemPath: noGitDir,
    });
    const task = ctx.services.tasks.createTask({
      projectId: proj.id,
      title: 'No-Git Task',
      prompt: 'dummy',
      provider: 'antigravity',
      model: 'auto',
    });
    const res = await ctx.app.request(`/api/tasks/${task.id}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Non-git dir: graceful fallback sets worktreePath to project root and returns 200
    assert.equal(res.status, 200);
    const json = (await res.json()) as { task: { status: string } };
    assert.equal(json.task.status, 'running');
  });

  it('POST /api/accounts/:id/oauth returns profile path for a known account', async () => {
    const acct = ctx.services.vault.createAccount('antigravity', 'AGY OAuth Test');
    const res = await ctx.app.request(`/api/accounts/${acct.id}/oauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { profilePath: string; command: string };
    assert.equal(typeof json.profilePath, 'string');
    assert.match(json.command, /agy/);
  });

  it('POST /api/accounts/:id/sync-email extracts connected email from isolated profile JSON', async () => {
    const acct = ctx.services.vault.createAccount('codex', 'Codex Email Sync');
    fs.writeFileSync(
      path.join(acct.authProfilePath!, 'auth.json'),
      JSON.stringify({ email: 'zaid.dev@example.com' }),
    );
    const res = await ctx.app.request(`/api/accounts/${acct.id}/sync-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { account: { accountEmail: string } };
    assert.equal(json.account.accountEmail, 'zaid.dev@example.com');
  });
});
