import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  AZURON_CHAT_PAGE_SIZE,
  type AnyProvider,
  type AttachmentRef,
  type ByokProvider,
  type Conversation,
  type CreateConversationInput,
  type ExecutionMode,
  type Message,
  type NativeProvider,
  type SendMessageInput,
  type UpdateConversationInput,
} from '@azuron/contract';
import {
  buildModeSystemPrompt,
  runAntigravityTurn,
  runByokTurn,
  runCodexTurn,
  type AgentRunResult,
} from '../core/agent-runner.js';
import type { AzuronPaths } from '../core/paths.js';
import type { AzuronStreamHub } from '../core/stream-hub.js';
import type { AzuronAccountVault } from '../core/vault.js';

export class AzuronChatManager {
  private readonly db: DatabaseSync;
  private readonly paths: AzuronPaths;
  private readonly vault: AzuronAccountVault;
  private readonly hub: AzuronStreamHub;

  constructor(
    db: DatabaseSync,
    paths: AzuronPaths,
    vault: AzuronAccountVault,
    hub: AzuronStreamHub,
  ) {
    this.db = db;
    this.paths = paths;
    this.vault = vault;
    this.hub = hub;
  }

  public listConversations(opts?: {
    projectId?: string;
    includeArchived?: boolean;
    search?: string;
  }): Conversation[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (!opts?.includeArchived) {
      clauses.push('is_archived = 0');
    }
    if (opts?.projectId) {
      clauses.push('project_id = ?');
      params.push(opts.projectId);
    }
    if (opts?.search?.trim()) {
      const q = `%${opts.search.trim()}%`;
      clauses.push(
        '(title LIKE ? OR id IN (SELECT DISTINCT conversation_id FROM messages WHERE content LIKE ?))',
      );
      params.push(q, q);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM conversations ${whereSql} ORDER BY is_pinned DESC, last_activity_at DESC`,
      )
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapConversation(r));
  }

  public getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapConversation(row) : null;
  }

  public createConversation(input: CreateConversationInput): Conversation {
    const id = `chat_${crypto.randomUUID().slice(0, 12)}`;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO conversations (id, project_id, account_id, provider, model, mode, title, is_pinned, is_archived, is_protected, last_activity_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
      )
      .run(
        id,
        input.projectId ?? null,
        input.accountId ?? null,
        input.provider,
        input.model,
        input.mode,
        input.title.trim(),
        now,
        now,
      );

    const created = this.getConversation(id)!;
    this.syncFolderSnapshot(created);
    return created;
  }

  public updateConversation(id: string, input: UpdateConversationInput): Conversation | null {
    const current = this.getConversation(id);
    if (!current) return null;

    const updated = {
      title: input.title?.trim() ?? current.title,
      provider: input.provider ?? current.provider,
      model: input.model ?? current.model,
      mode: input.mode ?? current.mode,
      accountId: input.accountId !== undefined ? input.accountId : current.accountId,
      isPinned: input.isPinned ?? current.isPinned,
      isArchived: input.isArchived ?? current.isArchived,
      isProtected: input.isProtected ?? current.isProtected,
    };

    this.db
      .prepare(
        `UPDATE conversations
         SET title = ?, provider = ?, model = ?, mode = ?, account_id = ?, is_pinned = ?, is_archived = ?, is_protected = ?
         WHERE id = ?`,
      )
      .run(
        updated.title,
        updated.provider,
        updated.model,
        updated.mode,
        updated.accountId,
        updated.isPinned ? 1 : 0,
        updated.isArchived ? 1 : 0,
        updated.isProtected ? 1 : 0,
        id,
      );

    const next = this.getConversation(id)!;
    this.syncFolderSnapshot(next);
    return next;
  }

  public deleteConversation(id: string): boolean {
    const current = this.getConversation(id);
    if (!current) return false;
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    const dir = this.resolveChatDirectory(current);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return true;
  }

  public listMessages(
    conversationId: string,
    opts?: { limit?: number; beforeCreatedAt?: number },
  ): Message[] {
    const limit = Math.min(Math.max(opts?.limit ?? AZURON_CHAT_PAGE_SIZE, 1), 100);
    const rows = (
      opts?.beforeCreatedAt !== undefined
        ? this.db
            .prepare(
              `SELECT * FROM (
                 SELECT * FROM messages
                 WHERE conversation_id = ? AND created_at < ?
                 ORDER BY created_at DESC LIMIT ?
               ) sub ORDER BY created_at ASC`,
            )
            .all(conversationId, opts.beforeCreatedAt, limit)
        : this.db
            .prepare(
              `SELECT * FROM (
                 SELECT * FROM messages
                 WHERE conversation_id = ?
                 ORDER BY created_at DESC LIMIT ?
               ) sub ORDER BY created_at ASC`,
            )
            .all(conversationId, limit)
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapMessage(r));
  }

  public appendMessage(
    conversationId: string,
    role: Message['role'],
    content: string,
    extra?: {
      attachments?: AttachmentRef[];
      tokensInput?: number;
      tokensOutput?: number;
      tokensCached?: number;
      costReported?: number | null;
    },
  ): Message {
    const conv = this.getConversation(conversationId);
    if (!conv) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const id = `msg_${crypto.randomUUID().slice(0, 12)}`;
    const now = Date.now();
    const attachments = extra?.attachments ?? [];

    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, tool_calls_json, attachments_json, tokens_input, tokens_output, tokens_cached, cost_reported, created_at)
         VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        conversationId,
        role,
        content,
        JSON.stringify(attachments),
        extra?.tokensInput ?? 0,
        extra?.tokensOutput ?? 0,
        extra?.tokensCached ?? 0,
        extra?.costReported ?? null,
        now,
      );

    this.db
      .prepare('UPDATE conversations SET last_activity_at = ? WHERE id = ?')
      .run(now, conversationId);

    const message: Message = {
      id,
      conversationId,
      role,
      content,
      toolCalls: [],
      attachments,
      tokensInput: extra?.tokensInput ?? 0,
      tokensOutput: extra?.tokensOutput ?? 0,
      tokensCached: extra?.tokensCached ?? 0,
      costReported: extra?.costReported ?? null,
      createdAt: now,
    };

    const chatDir = this.resolveChatDirectory(conv);
    fs.mkdirSync(chatDir, { recursive: true });
    fs.appendFileSync(path.join(chatDir, 'messages.jsonl'), `${JSON.stringify(message)}\n`, 'utf8');
    this.syncFolderSnapshot(this.getConversation(conversationId)!);

    return message;
  }

  public resolveExecutionMode(requested: ExecutionMode, prompt: string): ExecutionMode {
    if (requested !== 'auto') return requested;
    if (/\b(plan|architecture|design|blueprint|spec|banao)\b/i.test(prompt)) {
      return 'plan';
    }
    if (/\b(autonomous|end.?to.?end|beast|auto.?fix|full.?build)\b/i.test(prompt)) {
      return 'beast';
    }
    return 'code';
  }

  public async sendMessageAndExecute(
    conversationId: string,
    input: SendMessageInput,
  ): Promise<{ userMessage: Message; assistantMessage: Message }> {
    const conv = this.getConversation(conversationId);
    if (!conv) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const userMessage = this.appendMessage(conversationId, 'user', input.content, {
      attachments: input.attachments,
    });

    const requestedMode = input.mode ?? conv.mode;
    const effectiveMode = this.resolveExecutionMode(requestedMode, input.content);
    let provider: AnyProvider = input.provider ?? conv.provider;
    let model = input.model ?? conv.model;
    let accountId = input.accountId !== undefined ? input.accountId : conv.accountId;

    // Resolve 'auto' provider to an active native account or BYOK key
    if (provider === 'auto') {
      const activeNative =
        this.vault.listAccounts('antigravity').find((a) => a.isActive) ??
        this.vault.listAccounts('codex').find((a) => a.isActive);
      if (activeNative) {
        provider = activeNative.provider;
        accountId = activeNative.id;
      } else {
        const firstByok = this.vault.listByokKeys()[0];
        if (firstByok) {
          provider = firstByok.provider;
        }
      }
    }

    const projectRow = conv.projectId
      ? (this.db
          .prepare('SELECT filesystem_path, instructions FROM projects WHERE id = ?')
          .get(conv.projectId) as { filesystem_path: string; instructions: string } | undefined)
      : undefined;
    const cwd = projectRow?.filesystem_path || process.cwd();
    const systemPrompt = buildModeSystemPrompt(effectiveMode, projectRow?.instructions);

    this.hub.setActiveRun({
      id: conversationId,
      kind: 'chat',
      title: conv.title,
      step: `Running ${provider} (${effectiveMode})`,
      startedAt: Date.now(),
    });

    const executeWithProvider = async (
      targetProvider: AnyProvider,
      targetAccountId: string | null,
      targetModel: string,
    ): Promise<AgentRunResult> => {
      const onChunk = (chunk: Parameters<Parameters<typeof runCodexTurn>[1]>[0]) => {
        if (chunk.type === 'text') {
          this.hub.emit('chat', conversationId, 'chat.delta', { delta: chunk.delta });
        } else if (chunk.type === 'tool_call') {
          this.hub.emit('chat', conversationId, 'chat.tool_call', { ...chunk });
        } else if (chunk.type === 'tool_result') {
          this.hub.emit('chat', conversationId, 'chat.tool_result', { ...chunk });
        }
      };

      if (targetProvider === 'codex' || targetProvider === 'antigravity') {
        const account =
          (targetAccountId ? this.vault.getAccount(targetAccountId) : null) ??
          this.vault.listAccounts(targetProvider).find((a) => a.isActive) ??
          null;
        const req = {
          prompt: input.content,
          systemPrompt,
          cwd,
          model: targetModel,
          mode: effectiveMode,
          reasoningEffort: input.reasoningEffort,
          profilePath: account?.authProfilePath ?? null,
          attachments: input.attachments,
        };
        return targetProvider === 'codex'
          ? runCodexTurn(req, onChunk)
          : runAntigravityTurn(req, onChunk);
      }

      if (targetProvider !== 'auto') {
        const byok = this.vault.listByokKeys().find((k) => k.provider === targetProvider);
        const apiKey = byok ? this.vault.getDecryptedByokKey(byok.id) : null;
        return runByokTurn(
          targetProvider as ByokProvider,
          {
            prompt: input.content,
            systemPrompt,
            cwd,
            model: targetModel === 'auto' ? this.defaultByokModel(targetProvider as ByokProvider) : targetModel,
            mode: effectiveMode,
            apiKey,
            attachments: input.attachments,
          },
          onChunk,
        );
      }

      throw new Error('No connected provider accounts or BYOK API keys configured.');
    };

    let result: AgentRunResult;
    try {
      result = await executeWithProvider(provider, accountId, model);

      // Zero-Crash Quota Fallback Handover
      if (result.quotaExhausted && (provider === 'codex' || provider === 'antigravity')) {
        if (accountId) {
          this.vault.updateAccountStatus(accountId, 'quota_exhausted');
        }
        const nextSame = accountId
          ? this.vault.getNextFallbackAccount(provider as NativeProvider, accountId)
          : null;
        const altProvider: NativeProvider = provider === 'codex' ? 'antigravity' : 'codex';
        const nextAlt = nextSame ? null : this.vault.listAccounts(altProvider)[0] ?? null;
        const fallback = nextSame ?? nextAlt;

        if (fallback) {
          const notice = `Usage limit reached for ${provider}. Automatically switching to ${fallback.provider} (${fallback.accountName}) to continue.`;
          this.hub.emit('chat', conversationId, 'chat.fallback_notice', { message: notice });
          result = await executeWithProvider(fallback.provider, fallback.id, 'auto');
          result.fullText = `[NOTICE] ${notice}\n\n${result.fullText}`;
          provider = fallback.provider;
          accountId = fallback.id;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.hub.emit('chat', conversationId, 'chat.error', { message });
      this.hub.clearActiveRun(conversationId);
      const errMsg = this.appendMessage(conversationId, 'assistant', `[ERROR] ${message}`);
      return { userMessage, assistantMessage: errMsg };
    }

    const assistantMessage = this.appendMessage(
      conversationId,
      'assistant',
      result.fullText || '[INFO] Turn completed with empty text output.',
      {
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
        tokensCached: result.tokensCached,
        costReported: result.costReported,
      },
    );

    if (result.tokensInput > 0 || result.tokensOutput > 0) {
      this.db
        .prepare(
          `INSERT INTO usage_records (id, provider, account_id, model, task_id, conversation_id, tokens_input, tokens_output, tokens_cached, cost_reported, recorded_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `usg_${crypto.randomUUID().slice(0, 12)}`,
          provider,
          accountId,
          model,
          conversationId,
          result.tokensInput,
          result.tokensOutput,
          result.tokensCached,
          result.costReported,
          Date.now(),
        );
    }

    this.hub.emit('chat', conversationId, 'chat.turn_end', {
      messageId: assistantMessage.id,
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
    });
    this.hub.clearActiveRun(conversationId);

    return { userMessage, assistantMessage };
  }

  private defaultByokModel(provider: ByokProvider): string {
    switch (provider) {
      case 'groq':
        return 'llama-3.3-70b-versatile';
      case 'openrouter':
        return 'openai/gpt-4o-mini';
      case 'anthropic':
        return 'claude-3-5-sonnet-latest';
      case 'deepseek':
        return 'deepseek-chat';
      case 'google_ai_studio':
        return 'gemini-2.5-flash';
    }
  }

  private resolveChatDirectory(conv: Conversation): string {
    if (conv.projectId) {
      const slug = conv.projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
      return path.join(this.paths.projectChatsDir, slug, conv.id);
    }
    return path.join(this.paths.globalChatsDir, conv.id);
  }

  private syncFolderSnapshot(conv: Conversation): void {
    const chatDir = this.resolveChatDirectory(conv);
    fs.mkdirSync(chatDir, { recursive: true });
    fs.writeFileSync(path.join(chatDir, 'meta.json'), JSON.stringify(conv, null, 2), 'utf8');
  }

  private mapConversation(row: Record<string, unknown>): Conversation {
    return {
      id: String(row.id),
      projectId: row.project_id ? String(row.project_id) : null,
      accountId: row.account_id ? String(row.account_id) : null,
      provider: String(row.provider) as AnyProvider,
      model: String(row.model),
      mode: (row.mode ? String(row.mode) : 'auto') as ExecutionMode,
      title: String(row.title),
      isPinned: Number(row.is_pinned) === 1,
      isArchived: Number(row.is_archived) === 1,
      isProtected: Number(row.is_protected) === 1,
      lastActivityAt: Number(row.last_activity_at),
      createdAt: Number(row.created_at),
    };
  }

  private mapMessage(row: Record<string, unknown>): Message {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      role: String(row.role) as Message['role'],
      content: String(row.content),
      toolCalls: row.tool_calls_json ? JSON.parse(String(row.tool_calls_json)) : [],
      attachments: row.attachments_json ? JSON.parse(String(row.attachments_json)) : [],
      tokensInput: Number(row.tokens_input ?? 0),
      tokensOutput: Number(row.tokens_output ?? 0),
      tokensCached: Number(row.tokens_cached ?? 0),
      costReported: row.cost_reported !== null && row.cost_reported !== undefined ? Number(row.cost_reported) : null,
      createdAt: Number(row.created_at),
    };
  }
}
