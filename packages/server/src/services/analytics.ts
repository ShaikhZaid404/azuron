import type { DatabaseSync } from 'node:sqlite';

export interface HeatmapDay {
  date: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  totalTokens: number;
  tasksCount: number;
  topModel: string | null;
}

export class AzuronAnalyticsService {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public getSummary(opts?: {
    days?: number;
    accountIds?: string[];
  }): {
    totals: {
      tokensInput: number;
      tokensOutput: number;
      tokensCached: number;
      totalTokens: number;
      costReported: number | null;
    };
    byProvider: Array<{ provider: string; totalTokens: number; costReported: number | null }>;
    byAccount: Array<{ accountId: string; totalTokens: number }>;
    heatmap: HeatmapDay[];
  } {
    const days = opts?.days ?? 365;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const params: Array<string | number> = [cutoff];
    let accountFilter = '';

    if (opts?.accountIds && opts.accountIds.length > 0) {
      accountFilter = ` AND account_id IN (${opts.accountIds.map(() => '?').join(',')})`;
      params.push(...opts.accountIds);
    }

    const rows = this.db
      .prepare(
        `SELECT provider, account_id, model, task_id, tokens_input, tokens_output, tokens_cached, cost_reported, recorded_at
         FROM usage_records
         WHERE recorded_at >= ?${accountFilter}
         ORDER BY recorded_at ASC`,
      )
      .all(...params) as Array<{
      provider: string;
      account_id: string | null;
      model: string;
      task_id: string | null;
      tokens_input: number;
      tokens_output: number;
      tokens_cached: number;
      cost_reported: number | null;
      recorded_at: number;
    }>;

    let tokensInput = 0;
    let tokensOutput = 0;
    let tokensCached = 0;
    let costSum = 0;
    let hasReportedCost = false;

    const providerMap = new Map<string, { totalTokens: number; costSum: number; hasCost: boolean }>();
    const accountMap = new Map<string, number>();
    const dayMap = new Map<
      string,
      {
        tokensInput: number;
        tokensOutput: number;
        tokensCached: number;
        tasks: Set<string>;
        modelCounts: Map<string, number>;
      }
    >();

    for (const r of rows) {
      const rowTotal = r.tokens_input + r.tokens_output;
      tokensInput += r.tokens_input;
      tokensOutput += r.tokens_output;
      tokensCached += r.tokens_cached;

      if (r.cost_reported !== null) {
        costSum += r.cost_reported;
        hasReportedCost = true;
      }

      const pEntry = providerMap.get(r.provider) ?? { totalTokens: 0, costSum: 0, hasCost: false };
      pEntry.totalTokens += rowTotal;
      if (r.cost_reported !== null) {
        pEntry.costSum += r.cost_reported;
        pEntry.hasCost = true;
      }
      providerMap.set(r.provider, pEntry);

      if (r.account_id) {
        accountMap.set(r.account_id, (accountMap.get(r.account_id) ?? 0) + rowTotal);
      }

      const dayKey = new Date(r.recorded_at).toISOString().slice(0, 10);
      const dEntry = dayMap.get(dayKey) ?? {
        tokensInput: 0,
        tokensOutput: 0,
        tokensCached: 0,
        tasks: new Set<string>(),
        modelCounts: new Map<string, number>(),
      };
      dEntry.tokensInput += r.tokens_input;
      dEntry.tokensOutput += r.tokens_output;
      dEntry.tokensCached += r.tokens_cached;
      if (r.task_id) dEntry.tasks.add(r.task_id);
      dEntry.modelCounts.set(r.model, (dEntry.modelCounts.get(r.model) ?? 0) + rowTotal);
      dayMap.set(dayKey, dEntry);
    }

    const heatmap: HeatmapDay[] = Array.from(dayMap.entries()).map(([date, d]) => {
      let topModel: string | null = null;
      let maxTokens = -1;
      for (const [m, count] of d.modelCounts.entries()) {
        if (count > maxTokens) {
          maxTokens = count;
          topModel = m;
        }
      }
      return {
        date,
        tokensInput: d.tokensInput,
        tokensOutput: d.tokensOutput,
        tokensCached: d.tokensCached,
        totalTokens: d.tokensInput + d.tokensOutput,
        tasksCount: d.tasks.size,
        topModel,
      };
    });

    return {
      totals: {
        tokensInput,
        tokensOutput,
        tokensCached,
        totalTokens: tokensInput + tokensOutput,
        costReported: hasReportedCost ? costSum : null,
      },
      byProvider: Array.from(providerMap.entries()).map(([provider, v]) => ({
        provider,
        totalTokens: v.totalTokens,
        costReported: v.hasCost ? v.costSum : null,
      })),
      byAccount: Array.from(accountMap.entries()).map(([accountId, totalTokens]) => ({
        accountId,
        totalTokens,
      })),
      heatmap,
    };
  }
}
