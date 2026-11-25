import React, { useEffect, useState } from 'react';
import type { Account } from '@azuron/contract';
import { apiJson } from '../lib/api.js';

interface HeatmapDay {
  date: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  totalTokens: number;
  tasksCount: number;
  topModel: string | null;
}

interface AnalyticsData {
  totals: {
    tokensInput: number;
    tokensOutput: number;
    tokensCached: number;
    totalTokens: number;
    costReported: number | null;
  };
  byProvider: Array<{ provider: string; totalTokens: number; costReported: number | null }>;
  heatmap: HeatmapDay[];
}

export const UsagePage: React.FC = () => {
  const [days, setDays] = useState(30);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [hoveredDay, setHoveredDay] = useState<HeatmapDay | null>(null);

  const loadAnalytics = async (rangeDays: number, accIds: string[]) => {
    const qs = new URLSearchParams({ days: String(rangeDays) });
    if (accIds.length > 0) qs.set('accounts', accIds.join(','));
    const res = await apiJson<AnalyticsData>(`/api/analytics?${qs.toString()}`);
    setData(res);
  };

  useEffect(() => {
    void apiJson<{ accounts: Account[] }>('/api/accounts').then((r) => setAccounts(r.accounts));
    void loadAnalytics(days, selectedAccounts);
  }, []);

  const toggleAccount = (id: string) => {
    const next = selectedAccounts.includes(id)
      ? selectedAccounts.filter((x) => x !== id)
      : [...selectedAccounts, id];
    setSelectedAccounts(next);
    void loadAnalytics(days, next);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Usage Analytics & Activity Heatmap</h1>
          <p className="text-xs opacity-80">Zero-hallucination token consumption and reported provider costs</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[7, 19, 30, 90, 180, 365].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDays(d);
                void loadAnalytics(d, selectedAccounts);
              }}
              className="px-2.5 py-1 rounded border text-xs font-mono cursor-pointer"
              style={{
                backgroundColor: days === d ? 'var(--az-accent)' : 'transparent',
                color: days === d ? 'var(--az-accent-fg)' : 'var(--az-fg)',
                borderColor: days === d ? 'var(--az-accent)' : 'var(--az-border)',
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Multi-Account Filter Checkboxes */}
      {accounts.length > 0 && (
        <div className="p-3 rounded border flex flex-wrap gap-3 text-xs" style={{ borderColor: 'var(--az-border)' }}>
          {accounts.map((acc) => (
            <label key={acc.id} className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedAccounts.includes(acc.id)}
                onChange={() => toggleAccount(acc.id)}
              />
              <span>{acc.accountName} ({acc.provider})</span>
            </label>
          ))}
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
          <div className="text-xs opacity-80">Input Tokens</div>
          <div className="text-lg font-mono font-semibold mt-1">{data?.totals.tokensInput ?? 0}</div>
        </div>
        <div className="p-3.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
          <div className="text-xs opacity-80">Output Tokens</div>
          <div className="text-lg font-mono font-semibold mt-1">{data?.totals.tokensOutput ?? 0}</div>
        </div>
        <div className="p-3.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
          <div className="text-xs opacity-80">Cached Tokens</div>
          <div className="text-lg font-mono font-semibold mt-1">{data?.totals.tokensCached ?? 0}</div>
        </div>
        <div className="p-3.5 rounded border" style={{ borderColor: 'var(--az-border)' }}>
          <div className="text-xs opacity-80">Reported Cost</div>
          <div className="text-lg font-mono font-semibold mt-1">
            {data?.totals.costReported !== null && data?.totals.costReported !== undefined
              ? `$${data.totals.costReported.toFixed(4)}`
              : 'Unavailable'}
          </div>
        </div>
      </div>

      {/* GitHub-Style Activity Heatmap */}
      <div className="p-4 rounded border space-y-3" style={{ borderColor: 'var(--az-border)' }}>
        <div className="text-sm font-semibold">Daily Token Activity Grid</div>
        {data && data.heatmap.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {data.heatmap.map((day) => {
              const intensity = Math.min(1, Math.max(0.2, day.totalTokens / 10000));
              return (
                <button
                  key={day.date}
                  type="button"
                  onMouseEnter={() => setHoveredDay(day)}
                  onClick={() => setHoveredDay(day)}
                  className="w-5 h-5 rounded border cursor-pointer"
                  style={{
                    borderColor: 'var(--az-border)',
                    backgroundColor: '#7DBEFF',
                    opacity: intensity,
                    minHeight: '20px',
                  }}
                  title={`${day.date}: ${day.totalTokens} tokens`}
                />
              );
            })}
          </div>
        ) : (
          <div className="text-xs opacity-75">No usage records logged in the selected window yet.</div>
        )}

        {hoveredDay && (
          <div className="p-2.5 rounded border text-xs font-mono" style={{ borderColor: 'var(--az-border)' }}>
            Date: {hoveredDay.date} | Total: {hoveredDay.totalTokens} tokens | Top Model:{' '}
            {hoveredDay.topModel ?? 'N/A'}
          </div>
        )}
      </div>
    </div>
  );
};
