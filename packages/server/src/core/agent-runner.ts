/**
 * AZURON Agent Runner Abstraction & Native CLI / BYOK Adapters
 *
 * Notice: Runner abstraction and Codex JSON-RPC / Antigravity stream-json protocols
 * adapted from open-mercato/cezar (MIT License, (c) Patryk Lewczuk).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import type {
  AttachmentRef,
  ByokProvider,
  ExecutionMode,
  ModelDescriptor,
  NativeProvider,
  ReasoningEffort,
} from '@azuron/contract';

export interface AgentRunRequest {
  prompt: string;
  systemPrompt?: string;
  cwd: string;
  model: string;
  mode: ExecutionMode;
  reasoningEffort?: ReasoningEffort;
  profilePath?: string | null;
  apiKey?: string | null;
  attachments?: AttachmentRef[];
}

export type AgentStreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input?: unknown }
  | { type: 'tool_result'; id: string; name: string; output?: unknown }
  | { type: 'usage'; tokensInput: number; tokensOutput: number; tokensCached: number; costReported: number | null }
  | { type: 'quota_exhausted'; message: string }
  | { type: 'turn_end' }
  | { type: 'error'; message: string };

export interface AgentRunResult {
  fullText: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  costReported: number | null;
  quotaExhausted?: string;
}

export function buildModeSystemPrompt(mode: ExecutionMode, projectInstructions?: string): string {
  const persona = [
    'You are AZURON, a Senior Staff Principal Developer.',
    'Follow Bottom-Line-Up-Front (BLUF): lead directly with answers, code, or exact next steps.',
    'Never use emojis anywhere. Never include robotic filler.',
    'Whenever you write or modify code, outline and run verification tests and report actual observed results.',
  ].join(' ');

  let modeInstruction = '';
  switch (mode) {
    case 'plan':
      modeInstruction =
        'MODE: PLAN. Strictly design architecture, validate assumptions, and outline files/steps. Do NOT write implementation code yet.';
      break;
    case 'code':
      modeInstruction =
        'MODE: CODE. Directly implement clean, modular production code and verify with tests.';
      break;
    case 'beast':
      modeInstruction =
        'MODE: BEAST. Execute the full end-to-end engineering loop autonomously: inspect, implement, run tests, fix failures, and verify until complete.';
      break;
    case 'auto':
    default:
      modeInstruction =
        'MODE: AUTO. Infer intent from the user prompt: if planning/design is requested, plan thoroughly; if implementation is requested, code and test end-to-end.';
      break;
  }

  return [persona, modeInstruction, projectInstructions?.trim() ? `PROJECT INSTRUCTIONS:\n${projectInstructions.trim()}` : '']
    .filter(Boolean)
    .join('\n\n');
}

function isQuotaErrorText(text: string): boolean {
  return /quota|rate.?limit|429|usage limit|exhausted|insufficient_quota/i.test(text);
}

export async function runCodexTurn(
  req: AgentRunRequest,
  onChunk: (chunk: AgentStreamChunk) => void,
  signal?: AbortSignal,
): Promise<AgentRunResult> {
  const bin = process.env.AZURON_CODEX_BIN || 'codex';
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (req.profilePath) {
    env.CODEX_HOME = req.profilePath;
  }

  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, ['app-server'], { cwd: req.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }

    let fullText = '';
    let tokensInput = 0;
    let tokensOutput = 0;
    let tokensCached = 0;
    let settled = false;
    let rpcId = 1;
    let threadId: string | null = null;
    let stderrBuf = '';

    const cleanup = () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };

    if (signal) {
      signal.addEventListener('abort', cleanup, { once: true });
    }

    const sendRpc = (method: string, params: Record<string, unknown>) => {
      const id = rpcId++;
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return id;
    };

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as {
          id?: number;
          method?: string;
          result?: Record<string, unknown>;
          params?: Record<string, unknown>;
          error?: { message?: string };
        };

        if (msg.error?.message) {
          if (isQuotaErrorText(msg.error.message)) {
            onChunk({ type: 'quota_exhausted', message: msg.error.message });
            settled = true;
            cleanup();
            resolve({ fullText, tokensInput, tokensOutput, tokensCached, costReported: null, quotaExhausted: msg.error.message });
            return;
          }
          onChunk({ type: 'error', message: msg.error.message });
        }

        // Thread start response -> start turn
        if (msg.id === 1 && msg.result && !threadId) {
          const thr = (msg.result.thread as { id?: string } | undefined)?.id ?? (msg.result.threadId as string | undefined);
          threadId = thr ?? 'default';
          const combinedPrompt = req.systemPrompt ? `${req.systemPrompt}\n\nUSER:\n${req.prompt}` : req.prompt;
          sendRpc('turn/start', {
            threadId,
            input: [{ type: 'text', text: combinedPrompt }],
            ...(req.reasoningEffort ? { reasoningEffort: req.reasoningEffort } : {}),
          });
          return;
        }

        if (msg.method === 'item.delta' || msg.method === 'item/agentMessage/delta') {
          const delta =
            (msg.params?.delta as string | undefined) ??
            (msg.params?.text as string | undefined) ??
            '';
          if (delta) {
            fullText += delta;
            onChunk({ type: 'text', delta });
          }
        } else if (msg.method === 'turn/completed' || msg.method === 'turn.completed') {
          const usage = msg.params?.usage as Record<string, number> | undefined;
          if (usage) {
            tokensInput = usage.input_tokens ?? usage.inputTokens ?? 0;
            tokensOutput = usage.output_tokens ?? usage.outputTokens ?? 0;
            tokensCached = usage.cached_input_tokens ?? usage.cachedTokens ?? 0;
            onChunk({ type: 'usage', tokensInput, tokensOutput, tokensCached, costReported: null });
          }
          onChunk({ type: 'turn_end' });
          settled = true;
          cleanup();
          resolve({ fullText, tokensInput, tokensOutput, tokensCached, costReported: null });
        }
      } catch {
        // Ignore non-JSON log lines
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        if (stderrBuf && isQuotaErrorText(stderrBuf)) {
          resolve({ fullText, tokensInput, tokensOutput, tokensCached, costReported: null, quotaExhausted: stderrBuf.trim() });
        } else if (code !== 0 && !fullText) {
          reject(new Error(stderrBuf.trim() || `codex app-server exited with code ${code}`));
        } else {
          onChunk({ type: 'turn_end' });
          resolve({ fullText, tokensInput, tokensOutput, tokensCached, costReported: null });
        }
      }
    });

    sendRpc('thread/start', {
      model: req.model === 'auto' ? undefined : req.model,
      cwd: req.cwd,
    });
  });
}

export async function runAntigravityTurn(
  req: AgentRunRequest,
  onChunk: (chunk: AgentStreamChunk) => void,
  signal?: AbortSignal,
): Promise<AgentRunResult> {
  const bin = process.env.AZURON_AGY_BIN || 'agy';
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (req.profilePath) {
    env.GEMINI_CLI_CONFIG_DIR = req.profilePath;
  }

  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        bin,
        [
          '--input-format',
          'stream-json',
          '--output-format',
          'stream-json',
          '--dangerously-skip-permissions',
          '-p=',
        ],
        { cwd: req.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] },
      );
    } catch (err) {
      reject(err);
      return;
    }

    let fullText = '';
    let tokensInput = 0;
    let tokensOutput = 0;
    let tokensCached = 0;
    let settled = false;
    let stderrBuf = '';

    const cleanup = () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };
    if (signal) {
      signal.addEventListener('abort', cleanup, { once: true });
    }

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const frame = JSON.parse(trimmed) as {
          type?: string;
          event?: string;
          content?: string;
          delta?: string;
          message?: { content?: string };
          tool_call?: { id?: string; name?: string; input?: unknown };
          tool_result?: { id?: string; name?: string; output?: unknown };
          usage?: { input_tokens?: number; output_tokens?: number; cached_tokens?: number };
          error?: string;
        };

        const kind = frame.type || frame.event;
        if (kind === 'error' && frame.error) {
          if (isQuotaErrorText(frame.error)) {
            onChunk({ type: 'quota_exhausted', message: frame.error });
            settled = true;
            cleanup();
            resolve({ fullText, tokensInput, tokensOutput, tokensCached, costReported: null, quotaExhausted: frame.error });
            return;
          }
          onChunk({ type: 'error', message: frame.error });
          return;
        }

        const textPart = frame.delta ?? frame.content ?? frame.message?.content;
        if ((kind === 'text' || kind === 'step_update' || kind === 'assistant') && textPart) {
          fullText += textPart;
          onChunk({ type: 'text', delta: textPart });
        } else if (kind === 'tool_call' && frame.tool_call) {
          onChunk({
            type: 'tool_call',
            id: frame.tool_call.id ?? 'tool',
            name: frame.tool_call.name ?? 'tool',
            input: frame.tool_call.input,
          });
        } else if (kind === 'tool_result' && frame.tool_result) {
          onChunk({
            type: 'tool_result',
            id: frame.tool_result.id ?? 'tool',
            name: frame.tool_result.name ?? 'tool',
            output: frame.tool_result.output,
          });
        } else if (kind === 'result') {
          if (frame.usage) {
            tokensInput = frame.usage.input_tokens ?? 0;
            tokensOutput = frame.usage.output_tokens ?? 0;
            tokensCached = frame.usage.cached_tokens ?? 0;
            onChunk({ type: 'usage', tokensInput, tokensOutput, tokensCached, costReported: null });
          }
          onChunk({ type: 'turn_end' });
          settled = true;
          cleanup();
          resolve({ fullText, tokensInput, tokensOutput, tokensCached, costReported: null });
        }
      } catch {
        // Non-JSON line
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        if (stderrBuf && isQuotaErrorText(stderrBuf)) {
          resolve({ fullText, tokensInput, tokensOutput, tokensCached, costReported: null, quotaExhausted: stderrBuf.trim() });
        } else if (code !== 0 && !fullText) {
          reject(new Error(stderrBuf.trim() || `agy exited with code ${code}`));
        } else {
          onChunk({ type: 'turn_end' });
          resolve({ fullText, tokensInput, tokensOutput, tokensCached, costReported: null });
        }
      }
    });

    const attachmentNote =
      req.attachments && req.attachments.length > 0
        ? `\n\nATTACHED PATHS (zero-copy references):\n${req.attachments.map((a) => `- ${a.originalPath} (${a.mimeType}, ${a.sizeBytes} bytes)`).join('\n')}`
        : '';
    const content = [req.systemPrompt, req.prompt + attachmentNote].filter(Boolean).join('\n\n');
    child.stdin.write(`${JSON.stringify({ event: 'user', message: { content } })}\n`);
    child.stdin.end();
  });
}

export async function runByokTurn(
  provider: ByokProvider,
  req: AgentRunRequest,
  onChunk: (chunk: AgentStreamChunk) => void,
  signal?: AbortSignal,
): Promise<AgentRunResult> {
  if (!req.apiKey) {
    throw new Error(`Missing API key for BYOK provider: ${provider}`);
  }

  const endpointMap: Record<ByokProvider, string> = {
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions',
    anthropic: 'https://api.anthropic.com/v1/messages',
    google_ai_studio: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  };

  if (provider === 'anthropic') {
    const res = await fetch(endpointMap.anthropic, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: 4096,
        system: req.systemPrompt,
        messages: [{ role: 'user', content: req.prompt }],
      }),
      signal,
    });
    if (!res.ok) {
      const errBody = await res.text();
      if (res.status === 429 || isQuotaErrorText(errBody)) {
        return { fullText: '', tokensInput: 0, tokensOutput: 0, tokensCached: 0, costReported: null, quotaExhausted: errBody };
      }
      throw new Error(`Anthropic API error (${res.status}): ${errBody}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const fullText = data.content?.map((c) => c.text ?? '').join('') ?? '';
    const tokensInput = data.usage?.input_tokens ?? 0;
    const tokensOutput = data.usage?.output_tokens ?? 0;
    if (fullText) onChunk({ type: 'text', delta: fullText });
    onChunk({ type: 'usage', tokensInput, tokensOutput, tokensCached: 0, costReported: null });
    onChunk({ type: 'turn_end' });
    return { fullText, tokensInput, tokensOutput, tokensCached: 0, costReported: null };
  }

  const res = await fetch(endpointMap[provider], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({
      model: req.model,
      stream: false,
      messages: [
        ...(req.systemPrompt ? [{ role: 'system', content: req.systemPrompt }] : []),
        { role: 'user', content: req.prompt },
      ],
    }),
    signal,
  });

  if (!res.ok) {
    const errBody = await res.text();
    if (res.status === 429 || isQuotaErrorText(errBody)) {
      return { fullText: '', tokensInput: 0, tokensOutput: 0, tokensCached: 0, costReported: null, quotaExhausted: errBody };
    }
    throw new Error(`${provider} API error (${res.status}): ${errBody}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  const fullText = json.choices?.[0]?.message?.content ?? '';
  const tokensInput = json.usage?.prompt_tokens ?? 0;
  const tokensOutput = json.usage?.completion_tokens ?? 0;
  const tokensCached = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  if (fullText) onChunk({ type: 'text', delta: fullText });
  onChunk({ type: 'usage', tokensInput, tokensOutput, tokensCached, costReported: null });
  onChunk({ type: 'turn_end' });
  return { fullText, tokensInput, tokensOutput, tokensCached, costReported: null };
}

export async function probeCodexModels(profilePath?: string | null): Promise<ModelDescriptor[]> {
  const bin = process.env.AZURON_CODEX_BIN || 'codex';
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (profilePath) env.CODEX_HOME = profilePath;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (models: ModelDescriptor[]) => {
      if (!settled) {
        settled = true;
        resolve(models);
      }
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(bin, ['app-server'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      finish([]);
      return;
    }

    const timer = setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM');
      finish([]);
    }, 3500);

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line) as {
          id?: number;
          result?: {
            data?: Array<{
              id?: string;
              model?: string;
              displayName?: string;
              description?: string;
              supportedReasoningEfforts?: Array<{ reasoningEffort?: ReasoningEffort } | ReasoningEffort>;
            }>;
          };
        };
        if (msg.id === 1 && msg.result?.data) {
          clearTimeout(timer);
          if (!child.killed) child.kill('SIGTERM');
          const mapped: ModelDescriptor[] = msg.result.data.map((m) => ({
            id: m.id ?? m.model ?? 'unknown',
            displayName: m.displayName ?? m.id ?? 'Codex Model',
            description: m.description ?? '',
            provider: 'codex' as NativeProvider,
            accountId: null,
            accountName: null,
            status: 'available',
            supportedReasoningEfforts: (m.supportedReasoningEfforts ?? [])
              .map((r) => (typeof r === 'string' ? r : r.reasoningEffort))
              .filter((r): r is ReasoningEffort => r === 'low' || r === 'medium' || r === 'high'),
            supportsTools: true,
            supportsVision: true,
            contextWindow: null,
          }));
          finish(mapped);
        }
      } catch {
        // ignore
      }
    });

    child.on('error', () => {
      clearTimeout(timer);
      finish([]);
    });
    child.on('close', () => {
      clearTimeout(timer);
      finish([]);
    });

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'model/list', params: {} })}\n`);
  });
}
