import type { ModelDescriptor } from '@azuron/contract';
import { probeCodexModels } from '../core/agent-runner.js';
import type { AzuronEnvironmentInspector } from '../core/environment.js';
import type { AzuronAccountVault } from '../core/vault.js';

export class AzuronModelCenter {
  private readonly vault: AzuronAccountVault;
  private readonly env: AzuronEnvironmentInspector;
  private cachedModels: ModelDescriptor[] = [];
  private cachedAt = 0;
  private readonly cacheTtlMs = 60 * 60 * 1000; // 1 hour

  constructor(vault: AzuronAccountVault, env: AzuronEnvironmentInspector) {
    this.vault = vault;
    this.env = env;
  }

  public async listModels(forceRefresh = false): Promise<{
    models: ModelDescriptor[];
    cachedAt: number;
  }> {
    if (!forceRefresh && this.cachedAt > 0 && Date.now() - this.cachedAt < this.cacheTtlMs) {
      return { models: this.cachedModels, cachedAt: this.cachedAt };
    }

    const discovered: ModelDescriptor[] = [];
    const envInfo = await this.env.inspect();
    const accounts = this.vault.listAccounts();

    // 1. OpenAI Codex dynamic RPC discovery
    for (const acc of accounts.filter((a) => a.provider === 'codex')) {
      if (envInfo.codexInstalled) {
        const codexModels = await probeCodexModels(acc.authProfilePath);
        for (const m of codexModels) {
          discovered.push({
            ...m,
            accountId: acc.id,
            accountName: acc.accountName,
            status: acc.status === 'quota_exhausted' ? 'quota_exhausted' : 'available',
          });
        }
      }
    }

    // 2. Google Antigravity live CLI accounts (never invent unlisted models; expose native agy active session)
    for (const acc of accounts.filter((a) => a.provider === 'antigravity')) {
      if (envInfo.agyInstalled) {
        discovered.push({
          id: 'antigravity-default',
          displayName: 'Antigravity Native Agent',
          description: 'Uses authenticated agy CLI session entitlement',
          provider: 'antigravity',
          accountId: acc.id,
          accountName: acc.accountName,
          status: acc.status === 'quota_exhausted' ? 'quota_exhausted' : 'available',
          supportedReasoningEfforts: ['low', 'medium', 'high'],
          supportsTools: true,
          supportsVision: true,
          contextWindow: null,
        });
      }
    }

    // 3. BYOK API Keys live model ingestion
    for (const byok of this.vault.listByokKeys()) {
      const apiKey = this.vault.getDecryptedByokKey(byok.id);
      if (!apiKey) continue;
      if (byok.provider === 'groq' || byok.provider === 'openrouter') {
        const url =
          byok.provider === 'groq'
            ? 'https://api.groq.com/openai/v1/models'
            : 'https://openrouter.ai/api/v1/models';
        try {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(4000),
          });
          if (res.ok) {
            const payload = (await res.json()) as {
              data?: Array<{ id: string; name?: string; context_length?: number }>;
            };
            for (const item of (payload.data ?? []).slice(0, 40)) {
              discovered.push({
                id: item.id,
                displayName: item.name ?? item.id,
                description: `BYOK (${byok.label})`,
                provider: byok.provider,
                accountId: byok.id,
                accountName: byok.label,
                status: 'available',
                supportedReasoningEfforts: [],
                supportsTools: true,
                supportsVision: false,
                contextWindow: item.context_length ?? null,
              });
            }
          }
        } catch {
          // Offline or timeout — skip without fabricating
        }
      }
    }

    this.cachedModels = discovered;
    this.cachedAt = Date.now();
    return { models: this.cachedModels, cachedAt: this.cachedAt };
  }
}
